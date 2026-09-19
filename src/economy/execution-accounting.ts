import { db } from '../db/database';
import { financialTransaction } from '../db/financial-transaction';
import { listExecutionParticipants, postLedger, type ExecutionRow } from '../db/economy-repositories';

export function postExecutionCostShares(execution: ExecutionRow, costCents: number): void {
  return financialTransaction(db, 'economy', () => {
  if (!Number.isSafeInteger(costCents) || costCents < 0) throw new Error('execution cost must be nonnegative integer cents');
  if (costCents === 0) return;
  const suffix = execution.attempts > 0 ? `:attempt:${execution.attempts + 1}` : '';
  const participants = listExecutionParticipants(execution.id).sort((a, b) => a.agent_slug.localeCompare(b.agent_slug));
  if (participants.length > 0) {
    const share = Math.floor(costCents / participants.length);
    for (const [index, participant] of participants.entries()) {
      const posting = postLedger({
        agentSlug: participant.agent_slug,
        direction: 'debit',
        category: 'api_cost',
        amountCents: share + (index < costCents % participants.length ? 1 : 0),
        purpose: `execution ${execution.id} (${participant.role})`,
        refType: 'execution',
        refId: `exec:${execution.id}:api_cost:${participant.agent_slug}${suffix}`,
      });
      if (!posting.duplicate) db.run('UPDATE economy_execution_participants SET cost_share_cents = cost_share_cents + ? WHERE execution_id = ? AND agent_slug = ?', [share + (index < costCents % participants.length ? 1 : 0), execution.id, participant.agent_slug]);
    }
  } else {
    postLedger({
      agentSlug: execution.agent_slug,
      direction: 'debit',
      category: 'api_cost',
      amountCents: costCents,
      purpose: `execution ${execution.id}`,
      refType: 'execution',
      refId: `exec:${execution.id}:api_cost${suffix}`,
    });
  }
  });
}
