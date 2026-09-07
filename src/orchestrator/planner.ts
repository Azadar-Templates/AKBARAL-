import { discoverAgents, getAgentBySlug } from '../agents/registry';
import { createWorkflow, createWorkflowStep } from '../db';

/**
 * Master AI Planner.
 *
 * Converts a natural-language user goal into an execution plan: intent,
 * specialist agent selection (from the 4,000+ agent registry), model/tool
 * requirements, ordered steps and dependencies. The result is persisted as a
 * workflow + workflow_steps task graph that the execution engine runs.
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

const INTENT_RULES: Array<{ keys: PlanIntent['key']; label: string; categorySlug: string; roleKeys: string[]; keywords: string[] }> = [
  { keys: 'website', label: 'Build a website', categorySlug: 'web-development', roleKeys: ['strategist', 'builder', 'validator'], keywords: ['website', 'web', 'landing page', 'site'] },
  { keys: 'software', label: 'Build software', categorySlug: 'software-engineering', roleKeys: ['architect', 'builder', 'validator'], keywords: ['software', 'app', 'code', 'develop'] },
  { keys: 'mobile', label: 'Build mobile app', categorySlug: 'mobile-development', roleKeys: ['strategist', 'architect', 'validator'], keywords: ['mobile', 'ios', 'android', 'flutter', 'react native'] },
  { keys: 'brand', label: 'Create branding', categorySlug: 'branding', roleKeys: ['strategist', 'designer', 'author'], keywords: ['brand', 'branding', 'identity'] },
  { keys: 'research', label: 'Research', categorySlug: 'research', roleKeys: ['researcher', 'investigator'], keywords: ['research', 'competitor', 'market', 'investigate', 'compare'] },
  { keys: 'marketing', label: 'Marketing strategy', categorySlug: 'marketing', roleKeys: ['strategist', 'analyst', 'author'], keywords: ['marketing', 'campaign', 'growth', 'funnel'] },
  { keys: 'copywriting', label: 'Copywriting', categorySlug: 'copywriting', roleKeys: ['author', 'editor'], keywords: ['copy', 'write', 'content', 'script'] },
  { keys: 'seo', label: 'SEO', categorySlug: 'seo', roleKeys: ['seo-engineer', 'analyst'], keywords: ['seo', 'search engine', 'rank'] },
  { keys: 'social', label: 'Social content', categorySlug: 'social-media', roleKeys: ['strategist', 'author'], keywords: ['social', 'instagram', 'tiktok', 'youtube', 'x post'] },
  { keys: 'sales', label: 'Sales strategy', categorySlug: 'sales', roleKeys: ['sales-strategist', 'communicator'], keywords: ['sales', 'pipeline', 'outreach', 'customers'] },
  { keys: 'product', label: 'Product management', categorySlug: 'product-management', roleKeys: ['product-manager', 'strategist'], keywords: ['product', 'roadmap', 'feature'] },
  { keys: 'finance', label: 'Financial plan', categorySlug: 'finance', roleKeys: ['financial-modeler', 'finance-director'], keywords: ['finance', 'budget', 'revenue', 'cost', 'money'] },
  { keys: 'ecommerce', label: 'E-commerce', categorySlug: 'e-commerce', roleKeys: ['ecommerce-manager', 'analyst'], keywords: ['ecommerce', 'store', 'product listing', 'shop'] },
  { keys: 'launch', label: 'Launch plan', categorySlug: 'project-management', roleKeys: ['project-director', 'planner'], keywords: ['launch', 'plan', 'roadmap'] },
];

function detectIntents(goal: string): PlanIntent[] {
  const lower = goal.toLowerCase();
  const found: PlanIntent[] = [];
  for (const rule of INTENT_RULES) {
    if (rule.keywords.some((keyword) => lower.includes(keyword))) {
      found.push({
        key: rule.keys,
        label: rule.label,
        categorySlug: rule.categorySlug,
        roleKeys: rule.roleKeys,
        confidence: 0.9,
      });
    }
  }
  return found;
}

function agentSlugFor(categorySlug: string, roleKey: string): string | null {
  // Agent slugs are `${categorySlug}-${specialization.key}-NNN`; find the
  // specialist whose specialization key matches the role, then fall back to a
  // workflow/description match, then to the first agent in the category.
  const categoryAgents = discoverAgents({ category: categorySlug, limit: 200 });
  const slugPrefix = `${categorySlug}-${roleKey}-`;
  const exact = categoryAgents.agents.find((agent) => agent.slug.startsWith(slugPrefix));
  if (exact) {
    return exact.slug;
  }
  const semantic = categoryAgents.agents.find((agent) =>
    agent.specialization.toLowerCase().includes(roleKey.toLowerCase()) ||
    agent.workflow.some((step) => step.toLowerCase().includes(roleKey.toLowerCase())),
  );
  return semantic?.slug ?? categoryAgents.agents[0]?.slug ?? null;
}

/** Build and persist a workflow + step graph for a goal. */
export function createExecutionPlan(input: {
  userId: string;
  projectId?: string | null;
  goal: string;
}): { workflowId: string; plan: ExecutionPlan } {
  const intents = detectIntents(input.goal);
  if (intents.length === 0) {
    // Default plan: one research/analysis workflow is always useful and real.
    intents.push({
      key: 'general',
      label: 'Analyze goal',
      categorySlug: 'research',
      roleKeys: ['researcher'],
      confidence: 0.6,
    });
  }

  const steps: PlanStep[] = [];
  const notes: string[] = [];
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
      const agentSlug = agentSlugFor(intent.categorySlug, roleKey);
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

  // Persist graph.
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

  return { workflowId: workflow.id, plan: { intents, steps, notes } };
}
