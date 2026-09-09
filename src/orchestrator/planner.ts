import { discoverAgents, getAgentBySlug, type AgentView } from '../agents/registry';
import { createWorkflow, createWorkflowStep, db, findProjectById } from '../db';
import { HttpError } from '../server/http';
import { analyzeGoalHeuristic, type GoalAnalysis } from './goal-analyzer';

/**
 * Master AI Planner.
 *
 * Converts a structured goal analysis (from the goal analyzer) into an
 * execution plan: specialist agent selection (from the 4,000+ agent
 * registry), model/tool requirements, ordered steps and dependencies. The
 * result is persisted as a workflow + workflow_steps task graph that the
 * execution engine runs.
 */

export interface PlanIntent {
  key: string;
  label: string;
  categorySlug: string;
  roleKeys: string[];
  confidence: number;
}

export interface PlanStep {
  stepOrder: number;
  agentSlug: string;
  modelRequirements: string[];
  toolKeys: string[];
  goal: string;
  dependsOn: number[];
  categorySlug: string;
}

export interface ExecutionPlan {
  intents: PlanIntent[];
  steps: PlanStep[];
  notes: string[];
}

export interface ExecutionPlanResult {
  workflowId: string;
  plan: ExecutionPlan;
  analysis: GoalAnalysis;
}

const STOPWORDS = new Set([
  'with', 'that', 'this', 'from', 'have', 'will', 'your', 'about', 'into',
  'want', 'need', 'make', 'made', 'using', 'them', 'they', 'their', 'there',
  'would', 'could', 'should', 'must', 'please', 'help', 'give', 'like', 'and',
  'for', 'the', 'are', 'can',
]);

function goalTerms(goal: string): string[] {
  const words = goal.toLowerCase().match(/[a-z0-9]{4,}/g) ?? [];
  return [...new Set(words.filter((word) => !STOPWORDS.has(word)))];
}

/**
 * Score how well an agent matches the goal beyond its role key: overlap of
 * significant goal terms with the agent's specialization, capabilities,
 * declared outputs and description.
 */
function goalMatchScore(agent: AgentView, terms: string[]): number {
  if (terms.length === 0) {
    return 0;
  }
  const haystack = [
    agent.specialization,
    agent.description,
    ...agent.capabilities,
    ...agent.outputs,
  ]
    .join(' ')
    .toLowerCase();
  const hits = terms.filter((term) => haystack.includes(term)).length;
  return Math.min(24, hits * 3);
}

/**
 * Select the best specialist agent for a plan step. The specialization
 * (role) key is the primary signal (+40); goal-term overlap with the agent's
 * real profile breaks ties so the chosen specialist genuinely matches the
 * task instead of always taking the first agent with the right role prefix.
 */
export function selectBestAgent(
  categorySlug: string,
  roleKey: string,
  goal: string,
  userId: string,
): string | null {
  const categoryAgents = discoverAgents({ category: categorySlug, limit: 400, userId }).agents;
  if (categoryAgents.length === 0) {
    return null;
  }
  const terms = goalTerms(goal);
  const slugPrefix = `${categorySlug}-${roleKey}-`;

  let best: { slug: string; score: number } | null = null;
  for (const agent of categoryAgents) {
    let score = goalMatchScore(agent, terms);
    if (agent.slug.startsWith(slugPrefix)) {
      score += 40;
    }
    if (agent.status === 'active') {
      score += 2;
    }
    if (!best || score > best.score) {
      best = { slug: agent.slug, score };
    }
  }
  return best?.slug ?? null;
}

/** Back-compat: previous role-prefix-first selection, used when scoring ties. */

/** Build and persist a workflow + step graph for a goal. */
export function createExecutionPlan(input: {
  userId: string;
  projectId?: string | null;
  goal: string;
  /** Pre-computed goal analysis (LLM or heuristic). When absent the deterministic analyzer runs. */
  analysis?: GoalAnalysis;
}): ExecutionPlanResult {
  if (input.projectId) {
    const project = findProjectById(input.projectId);
    if (!project || String(project.owner_id) !== input.userId) {
      throw new HttpError(403, 'project does not belong to the current user', 'forbidden');
    }
  }

  const analysis = input.analysis ?? analyzeGoalHeuristic(input.goal);
  const intents: PlanIntent[] = analysis.intents.map((intent) => ({
    key: intent.key,
    label: intent.label,
    categorySlug: intent.categorySlug,
    roleKeys: [...intent.roleKeys],
    confidence: intent.confidence,
  }));
  if (intents.length === 0) {
    intents.push({
      key: 'general',
      label: 'Analyze goal',
      categorySlug: 'research',
      roleKeys: ['researcher'],
      confidence: 0.6,
    });
  }

  const steps: PlanStep[] = [];
  const notes: string[] = [
    `Goal analysis mode: ${analysis.mode}.`,
    ...analysis.notes,
  ];
  let stepOrder = 0;
  const previousIntentStepByCategory = new Map<string, number>();

  const workflow = createWorkflow({
    userId: input.userId,
    projectId: input.projectId ?? null,
    goal: input.goal,
    intent: intents.map((intent) => intent.key).join(','),
  });

  for (const intent of intents) {
    const categorySteps: number[] = [];
    for (const roleKey of intent.roleKeys) {
      const agentSlug = selectBestAgent(intent.categorySlug, roleKey, input.goal, input.userId);
      const agent = agentSlug ? getAgentBySlug(agentSlug) : undefined;
      const dependsOn = [
        ...(previousIntentStepByCategory.has(intent.categorySlug)
          ? [previousIntentStepByCategory.get(intent.categorySlug)!]
          : []),
        ...categorySteps,
      ];
      steps.push({
        stepOrder,
        agentSlug: agent?.slug ?? '',
        modelRequirements: agent?.modelRequirements ?? ['reasoning'],
        toolKeys: agent?.toolPermissions ?? [],
        goal: `${intent.label}: ${input.goal}`,
        dependsOn,
        categorySlug: intent.categorySlug,
      });
      categorySteps.push(stepOrder);
      ++stepOrder;
    }
    previousIntentStepByCategory.set(intent.categorySlug, categorySteps[categorySteps.length - 1]);
    notes.push(`${intent.label} -> ${intent.roleKeys.length} specialist agent(s) in ${intent.categorySlug}`);
  }

  // Persist graph + the full plan (analysis and steps) for observability.
  for (const step of steps) {
    createWorkflowStep({
      workflowId: workflow.id,
      agentId: step.agentSlug ? getAgentBySlug(step.agentSlug)?.id ?? null : null,
      modelKey: null,
      toolKey: step.toolKeys[0] ?? null,
      stepOrder: step.stepOrder,
      dependsOn: step.dependsOn.map(String),
    });
  }
  persistPlan(workflow.id, { analysis, steps, notes });

  return { workflowId: workflow.id, plan: { intents, steps, notes }, analysis };
}

function persistPlan(
  workflowId: string,
  plan: { analysis: GoalAnalysis; steps: PlanStep[]; notes: string[] },
): void {
  db.run(
    `UPDATE workflows SET plan_json=?, updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=?`,
    [JSON.stringify(plan), workflowId],
  );
}
