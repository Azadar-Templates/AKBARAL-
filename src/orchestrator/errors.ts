/**
 * Execution error classification (Milestone 3).
 *
 * Retry policy: only failures that can plausibly succeed on a retry
 * (transient provider/network issues, timeouts) are retried. Permanent
 * failures — missing credentials, failed verification, invalid input,
 * security blocks — fail immediately so the free task credit is refunded
 * without wasting the user's time on doomed retries.
 */

export const PERMANENT_ERROR_CODES = new Set([
  'provider_not_configured',
  'verification_failed',
  'agent_not_found',
  'requires_pro',
  'task_creation_failed',
  'validation_error',
  'tool_input_error',
  'emergency_stop',
  'cancelled',
  'forbidden',
  'not_found',
  'unauthorized',
  'parsing_failed',
]);

export interface ErrorClassification {
  code: string;
  retryable: boolean;
}

export function classifyExecutionError(error: {
  code?: string | null;
  message: string;
  /** Explicit retryability from a typed provider error overrides inference. */
  retryable?: boolean | null;
}): ErrorClassification {
  const message = error.message ?? '';
  let code = error.code ?? '';

  if (!code) {
    if (message.includes('not configured') || message.includes('provider_not_configured')) {
      code = 'provider_not_configured';
    } else if (message.startsWith('verification_failed')) {
      code = 'verification_failed';
    } else if (message.includes('timed out') || message.includes('timeout')) {
      code = 'timed_out';
    } else {
      code = 'execution_failed';
    }
  }

  if (error.retryable !== undefined && error.retryable !== null) {
    // Typed signal (e.g. ProviderCallError.retryable) wins: a permanent 4xx
    // provider failure must not burn the retry budget, and a transient 5xx
    // must stay retryable even when the code alone looks generic.
    return { code, retryable: error.retryable };
  }
  return {
    code,
    retryable: !PERMANENT_ERROR_CODES.has(code),
  };
}
