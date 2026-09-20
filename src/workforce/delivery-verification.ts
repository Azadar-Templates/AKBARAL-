import type { ToolResult } from '../tools';

/** Empty search hits and tool errors are not supporting evidence. */
export function usableToolEvidence(result: ToolResult): boolean {
  if (!result.ok || !result.content.trim()) return false;
  if (Array.isArray(result.data?.results) && result.data.results.length === 0) return false;
  return !['[]', '{}', 'null'].includes(result.content.trim());
}

/** Automated preflight only, not customer acceptance or proof of payment. */
export function verifyWorkforceDelivery(output: string, successfulTools: number): { verified: boolean; reasons: string[]; level: string } {
  const reasons: string[] = [];
  if (output.trim().length < 40) reasons.push('deliverable_too_short');
  if (successfulTools < 1) reasons.push('no_successful_tool_evidence');
  if (/\b(?:as an ai|i cannot|i can.t|unable to|missing prerequisite)\b/i.test(output) ||
      /\b(?:missing|requires?|need|unavailable|not configured|must obtain)\b[^.\n]{0,80}\b(?:credentials?|accounts?|approval|api key|access)\b/i.test(output) ||
      /\b(?:credentials?|accounts?|approval|api key|access)\b[^.\n]{0,50}\b(?:missing|unavailable|not configured|required)\b/i.test(output)) {
    reasons.push('missing_prerequisite_or_refusal');
  }
  return { verified: reasons.length === 0, reasons, level: 'automated_preflight_not_customer_acceptance' };
}
