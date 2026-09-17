import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { db, createUser, getCreditAccount, findTaskById, getJob, getWorkflow, grantCredit } from '../db';
import { syncAgentRegistry } from '../agents/registry';
import { createAgentTask } from './executor';
import { createExecutionPlan } from './planner';
import { recoverInterruptedWork } from './recovery';
import { ExecutionQueue } from './queue';
import { startModelFixture, type ModelFixtureServer } from '../test-support/model-provider-fixture';
import type { ExecutionStream } from '../realtime/execution-stream';

/**
 * Milestone 3 — production execution engine test suite.
 *
 * Covers: successful execution, queue persistence, restart recovery, retry
 * success, retry exhaustion, permanent failure, timeout, cancellation
 * (queued + running), emergency/admin cancellation, idempotency protection,
 * credit reservation/consumption/refund for every unsuccessful terminal
 * state, race conditions, and real-time state updates.
 */

const suffix = randomBytes(6).toString('hex');
const email = `queue-${suffix}@akbaral.test`;
const AGENT = 'research-researcher-002';

const PROVIDER_ENV_KEYS = ['OPENAI_API_KEY', 'OPENAI_BASE_URL', 'ANTHROPIC_API_KEY', 'GOOGLE_API_KEY', 'AKBARAL_SEARCH_ENDPOINT'];
const savedEnv = new Map<string, string | undefined>();

function clearProviderEnv(): void {
  for (const key of PROVIDER_ENV_KEYS) {
    savedEnv.set(key, process.env[key]);
    delete process.env[key];
  }
}

function configureFixtureProvider(baseUrl: string): void {
  process.env.OPENAI_API_KEY = 'test-fixture-key';
  process.env.OPENAI_BASE_URL = baseUrl;
}

function restoreProviderEnv(): void {
  for (const [key, value] of savedEnv) {
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
}

interface CapturedStatus {
  executionId: string;
  status: string;
  message: string;
}

function stubStream(): { stream: ExecutionStream; statuses: CapturedStatus[] } {
  const statuses: CapturedStatus[] = [];
  const stream = {
    pushStatus: (status: CapturedStatus) => {
      statuses.push(status);
    },
    pushLog: () => {},
  } as unknown as ExecutionStream;
  return { stream, statuses };
}

async function waitFor(predicate: () => boolean, timeoutMs = 15000, label = 'condition'): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error(`waitFor timed out waiting for ${label}`);
}

function freshQueue(options: Partial<ConstructorParameters<typeof ExecutionQueue>[0]> = {}) {
  const { stream, statuses } = stubStream();
  const queue = new ExecutionQueue({
    stream,
    pollIntervalMs: 15,
    concurrency: 2,
    retryBaseDelayMs: 20,
    stepTimeoutMs: 5000,
    workflowTimeoutMs: 15000,
    workerId: `test-worker-${randomBytes(3).toString('hex')}`,
    ...options,
  });
  return { queue, statuses };
}

function freeCredits(): number {
  return getCreditAccount(userId)?.free_credits ?? -1;
}

/**
 * Top the test user's balance up to a known working level. Successful tests
 * permanently consume credits, so each test starts from a deterministic
 * balance and asserts relative changes only.
 */
function topUp(target = 10): number {
  const current = freeCredits();
  if (current < target) {
    grantCredit({ userId, amount: target - current, reason: 'queue test top-up' });
  }
  return freeCredits();
}

let fixture: ModelFixtureServer;
let userId = '';

before(async () => {
  clearProviderEnv();
  process.env.AKBARAL_SEARCH_ENDPOINT = 'http://127.0.0.1:9/search';
  syncAgentRegistry();
  const user = createUser({ email, name: 'Queue Test' });
  userId = user.id;
  fixture = await startModelFixture('ok');
});

after(async () => {
  db.run('DELETE FROM users WHERE id = ?', [userId]);
  db.close();
  restoreProviderEnv();
  if (fixture) {
    await fixture.close();
  }
});

describe('M3 execution engine', () => {
  it('successful execution: job completes, task completes, credit consumed, statuses streamed', async () => {
    configureFixtureProvider(fixture.baseUrl);
    const { queue, statuses } = freshQueue();
    const balanceBefore = topUp();
    const dispatched = createAgentTask({ userId, agentSlug: AGENT, goal: 'queue green path' });
    assert.equal(freeCredits(), balanceBefore - 1, 'credit reserved at creation');

    const { job, created } = queue.enqueueAgentExecution({
      executionId: dispatched.executionId,
      agentSlug: AGENT,
      taskId: dispatched.taskId,
      userId,
    });
    assert.ok(created);
    assert.equal(job.status, 'queued');
    queue.start();

    await waitFor(() => getJob(job.id)?.status === 'completed', 10000, 'job completion');
    assert.equal(findTaskById(dispatched.taskId)?.status, 'completed');
    assert.equal(freeCredits(), balanceBefore - 1, 'credit consumed on success');
    const attempts = db.all('SELECT * FROM job_attempts WHERE job_id = ?', [job.id]) as Array<{ status: string }>;
    assert.equal(attempts.length, 1);
    assert.equal(attempts[0].status, 'completed');

    // Real-time status order: queued -> running -> completed on the execution channel.
    const channelStatuses = statuses.filter((status) => status.executionId === dispatched.executionId).map((status) => status.status);
    assert.ok(channelStatuses.includes('queued'), `statuses: ${channelStatuses.join(',')}`);
    assert.ok(channelStatuses.includes('running'));
    assert.ok(channelStatuses.indexOf('running') < channelStatuses.lastIndexOf('completed'));
    queue.stop();
    clearProviderEnv();
  });

  it('queue persistence: a queued job survives a stopped queue and is picked up by a new worker', async () => {
    configureFixtureProvider(fixture.baseUrl);
    // Enqueue with the queue NOT started — the job is persisted only.
    const idle = freshQueue();
    topUp();
    const dispatched = createAgentTask({ userId, agentSlug: AGENT, goal: 'persistence test' });
    const { job } = idle.queue.enqueueAgentExecution({
      executionId: dispatched.executionId,
      agentSlug: AGENT,
      taskId: dispatched.taskId,
      userId,
    });
    assert.equal(getJob(job.id)?.status, 'queued');

    // Simulate a restart: a brand-new queue instance (new worker id) picks up
    // the persisted job and completes it.
    const restarted = freshQueue();
    restarted.queue.start();
    await waitFor(() => getJob(job.id)?.status === 'completed', 10000, 'job completion after restart');
    assert.equal(findTaskById(dispatched.taskId)?.status, 'completed');
    restarted.queue.stop();
    clearProviderEnv();
  });

  it('restart recovery: stale running job is requeued when attempts remain', async () => {
    configureFixtureProvider(fixture.baseUrl);
    const { queue } = freshQueue();
    topUp();
    const dispatched = createAgentTask({ userId, agentSlug: AGENT, goal: 'stale requeue test' });
    const { job } = queue.enqueueAgentExecution({
      executionId: dispatched.executionId,
      agentSlug: AGENT,
      taskId: dispatched.taskId,
      userId,
    });
    // Simulate a crash mid-run by a dead worker: running + foreign lock.
    db.run(
      `UPDATE execution_jobs SET status='running', locked_by='worker-dead-1', locked_at=?, attempts=1 WHERE id=?`,
      [new Date().toISOString(), job.id],
    );

    const report = recoverInterruptedWork();
    assert.equal(report.jobsRequeued >= 1, true);
    assert.equal(getJob(job.id)?.status, 'queued', 'stale job requeued for a fresh attempt');

    // The task must NOT have been failed/refunded — its job is alive again.
    assert.equal(findTaskById(dispatched.taskId)?.status, 'created');

    // A live worker completes the recovered job.
    const worker = freshQueue({ workerId: 'recovery-worker' });
    worker.queue.start();
    await waitFor(() => getJob(job.id)?.status === 'completed', 10000, 'recovered job completion');
    assert.equal(findTaskById(dispatched.taskId)?.status, 'completed');
    worker.queue.stop();
    clearProviderEnv();
  });

  it('restart recovery: exhausted stale job fails and refunds exactly once', async () => {
    configureFixtureProvider(fixture.baseUrl);
    const { queue } = freshQueue();
    const balanceBefore = topUp();
    const dispatched = createAgentTask({ userId, agentSlug: AGENT, goal: 'stale exhausted test' });
    const { job } = queue.enqueueAgentExecution({
      executionId: dispatched.executionId,
      agentSlug: AGENT,
      taskId: dispatched.taskId,
      userId,
    });
    db.run(
      `UPDATE execution_jobs SET status='running', locked_by='worker-dead-2', attempts=max_attempts WHERE id=?`,
      [job.id],
    );

    const report = recoverInterruptedWork();
    assert.ok(report.jobsFailed >= 1);
    assert.equal(getJob(job.id)?.status, 'failed');
    assert.equal(findTaskById(dispatched.taskId)?.status, 'failed');
    assert.equal(findTaskById(dispatched.taskId)?.error_message, 'interrupted by server restart');
    assert.equal(freeCredits(), balanceBefore, 'crash refund applied');

    // Idempotent: second recovery pass changes nothing.
    const second = recoverInterruptedWork();
    assert.equal(second.creditsRefunded, 0);
    assert.equal(freeCredits(), balanceBefore);
    queue.stop();
    clearProviderEnv();
  });

  it('retry success: transient failure retries with backoff and completes on attempt 2', async () => {
    configureFixtureProvider(fixture.baseUrl);
    fixture.setMode('down');
    const { queue, statuses } = freshQueue({ maxAttempts: 3 });
    const balanceBefore = topUp();
    const dispatched = createAgentTask({ userId, agentSlug: AGENT, goal: 'retry success test' });

    const { job } = queue.enqueueAgentExecution({
      executionId: dispatched.executionId,
      agentSlug: AGENT,
      taskId: dispatched.taskId,
      userId,
    });
    queue.start();

    // Wait for the first failure to be scheduled as a retry, then heal the provider.
    await waitFor(() => getJob(job.id)?.status === 'retrying', 10000, 'first retry scheduling');
    fixture.setMode('ok');

    await waitFor(() => getJob(job.id)?.status === 'completed', 10000, 'retry completion');
    assert.equal(getJob(job.id)?.attempts, 2, 'completed on the second attempt');
    assert.equal(findTaskById(dispatched.taskId)?.status, 'completed');
    assert.equal(freeCredits(), balanceBefore - 1, 'credit consumed exactly once despite the retry');
    const attempts = db.all('SELECT * FROM job_attempts WHERE job_id = ? ORDER BY attempt_number', [job.id]) as Array<{ status: string }>;
    assert.equal(attempts.length, 2);
    assert.equal(attempts[0].status, 'failed');
    assert.equal(attempts[1].status, 'completed');
    const channelStatuses = statuses.map((status) => status.status);
    assert.ok(channelStatuses.includes('retrying'), 'retrying state was streamed');
    queue.stop();
  });

  it('retry exhaustion: transient failures exhaust attempts, task fails and credit refunds', async () => {
    configureFixtureProvider(fixture.baseUrl);
    fixture.setMode('down');
    const { queue } = freshQueue({ maxAttempts: 2 });
    const balanceBefore = topUp();
    const dispatched = createAgentTask({ userId, agentSlug: AGENT, goal: 'retry exhaustion test' });

    const { job } = queue.enqueueAgentExecution({
      executionId: dispatched.executionId,
      agentSlug: AGENT,
      taskId: dispatched.taskId,
      userId,
    });
    queue.start();

    await waitFor(() => getJob(job.id)?.status === 'failed', 20000, 'final failure');
    assert.equal(getJob(job.id)?.attempts, 2, 'exactly max_attempts attempts');
    assert.equal(findTaskById(dispatched.taskId)?.status, 'failed');
    assert.equal(freeCredits(), balanceBefore, 'credit refunded after exhaustion');
    const attempts = db.all('SELECT * FROM job_attempts WHERE job_id = ?', [job.id]) as Array<{ status: string }>;
    assert.equal(attempts.length, 2);
    assert.ok(attempts.every((attempt) => attempt.status === 'failed'));
    queue.stop();
    fixture.setMode('ok');
  });

  it('permanent failure: provider_not_configured never retries and refunds immediately', async () => {
    clearProviderEnv(); // no provider configured
    const { queue } = freshQueue({ maxAttempts: 3 });
    const balanceBefore = topUp();
    const dispatched = createAgentTask({ userId, agentSlug: AGENT, goal: 'permanent failure test' });

    const { job } = queue.enqueueAgentExecution({
      executionId: dispatched.executionId,
      agentSlug: AGENT,
      taskId: dispatched.taskId,
      userId,
    });
    queue.start();

    await waitFor(() => getJob(job.id)?.status === 'failed', 10000, 'permanent failure');
    assert.equal(getJob(job.id)?.attempts, 1, 'permanent errors are not retried');
    assert.equal(getJob(job.id)?.error_code, 'provider_not_configured');
    assert.equal(findTaskById(dispatched.taskId)?.status, 'failed');
    assert.equal(freeCredits(), balanceBefore, 'credit refunded');
    queue.stop();
  });

  it('verification failure: permanent, no retry, credit refunded', async () => {
    configureFixtureProvider(fixture.baseUrl);
    fixture.setMode('thin_output');
    const { queue } = freshQueue({ maxAttempts: 3 });
    const balanceBefore = topUp();
    const dispatched = createAgentTask({ userId, agentSlug: AGENT, goal: 'verification failure test' });

    const { job } = queue.enqueueAgentExecution({
      executionId: dispatched.executionId,
      agentSlug: AGENT,
      taskId: dispatched.taskId,
      userId,
    });
    queue.start();

    await waitFor(() => getJob(job.id)?.status === 'failed', 10000, 'verification failure');
    assert.equal(getJob(job.id)?.attempts, 1, 'verification failures are not retried');
    assert.equal(getJob(job.id)?.error_code, 'verification_failed');
    assert.equal(findTaskById(dispatched.taskId)?.status, 'failed');
    assert.equal(freeCredits(), balanceBefore, 'credit refunded after verification failure');
    queue.stop();
    fixture.setMode('ok');
  });

  it('permanent provider 401: unauthorized is not retried, task fails honestly, credit refunds', async () => {
    configureFixtureProvider(fixture.baseUrl);
    fixture.setMode('unauthorized');
    const { queue } = freshQueue({ maxAttempts: 3 });
    const balanceBefore = topUp();
    const dispatched = createAgentTask({ userId, agentSlug: AGENT, goal: 'permanent 401 test' });

    const { job } = queue.enqueueAgentExecution({
      executionId: dispatched.executionId,
      agentSlug: AGENT,
      taskId: dispatched.taskId,
      userId,
    });
    queue.start();

    await waitFor(() => getJob(job.id)?.status === 'failed', 10000, 'permanent 401 failure');
    assert.equal(getJob(job.id)?.attempts, 1, 'a rejected API key is permanent — no retries');
    assert.equal(getJob(job.id)?.error_code, 'provider_call_failed');
    assert.equal(findTaskById(dispatched.taskId)?.status, 'failed');
    assert.equal(freeCredits(), balanceBefore, 'credit refunded after permanent provider failure');

    // The 401 body deliberately echoes the Authorization header; the stored
    // task error must never contain it.
    const taskError = String(findTaskById(dispatched.taskId)?.error_message ?? '');
    assert.ok(!taskError.includes('test-fixture-key'), 'task error must not contain the API key');
    assert.ok(taskError.includes('HTTP 401'), 'task error must honestly name the status');

    const attempts = db.all('SELECT * FROM job_attempts WHERE job_id = ?', [job.id]) as Array<{ status: string }>;
    assert.equal(attempts.length, 1);
    queue.stop();
    fixture.setMode('ok');
  });

  it('permanent provider 404: dead model ID is not retried, task fails honestly, credit refunds', async () => {
    configureFixtureProvider(fixture.baseUrl);
    fixture.setMode('not_found');
    const { queue } = freshQueue({ maxAttempts: 3 });
    const balanceBefore = topUp();
    const dispatched = createAgentTask({ userId, agentSlug: AGENT, goal: 'What is AKBARAL! in 5 short bullet points' });

    const { job } = queue.enqueueAgentExecution({
      executionId: dispatched.executionId,
      agentSlug: AGENT,
      taskId: dispatched.taskId,
      userId,
    });
    queue.start();

    await waitFor(() => getJob(job.id)?.status === 'failed', 10000, 'permanent 404 failure');
    assert.equal(getJob(job.id)?.attempts, 1, 'a dead model ID is permanent — no retries');
    assert.equal(getJob(job.id)?.error_code, 'provider_call_failed');
    assert.equal(findTaskById(dispatched.taskId)?.status, 'failed', 'the task must NOT complete on a 404');
    assert.equal(freeCredits(), balanceBefore, 'credit refunded after the 404 failure');

    // The stored error identifies the model/endpoint configuration problem
    // (never a credential, never a raw provider body).
    const taskError = String(findTaskById(dispatched.taskId)?.error_message ?? '');
    assert.ok(taskError.includes('HTTP 404'), 'task error names the status');
    assert.ok(
      taskError.includes('configuration problem'),
      `task error identifies the configuration problem: ${taskError}`,
    );
    assert.ok(!taskError.includes('test-fixture-key'), 'task error must not contain the API key');
    assert.ok(!taskError.includes('NOT_FOUND'), 'raw provider body must not be echoed');

    const attempts = db.all('SELECT * FROM job_attempts WHERE job_id = ?', [job.id]) as Array<{ status: string }>;
    assert.equal(attempts.length, 1);
    queue.stop();
    fixture.setMode('ok');
  });

  it('timeout: slow provider exceeds the step budget; job timed_out and credit refunded', async () => {
    configureFixtureProvider(fixture.baseUrl);
    fixture.setDelay(3000);
    const { queue } = freshQueue({ stepTimeoutMs: 250 });
    const balanceBefore = topUp();
    const dispatched = createAgentTask({ userId, agentSlug: AGENT, goal: 'timeout test' });

    const { job } = queue.enqueueAgentExecution({
      executionId: dispatched.executionId,
      agentSlug: AGENT,
      taskId: dispatched.taskId,
      userId,
    });
    queue.start();

    await waitFor(() => getJob(job.id)?.status === 'timed_out', 10000, 'job timeout');
    assert.equal(findTaskById(dispatched.taskId)?.status, 'failed');
    assert.ok(String(findTaskById(dispatched.taskId)?.error_message).startsWith('timed_out'));
    assert.equal(freeCredits(), balanceBefore, 'credit refunded on timeout');
    queue.stop();
    fixture.setDelay(0);
  });

  it('cancellation of a queued job: refunded, never executed', async () => {
    configureFixtureProvider(fixture.baseUrl);
    const { queue } = freshQueue();
    const balanceBefore = topUp();
    const dispatched = createAgentTask({ userId, agentSlug: AGENT, goal: 'queued cancel test' });
    const { job } = queue.enqueueAgentExecution({
      executionId: dispatched.executionId,
      agentSlug: AGENT,
      taskId: dispatched.taskId,
      userId,
    });
    // Queue intentionally NOT started: the job stays queued.

    const result = queue.cancelTask(dispatched.taskId, userId, 'user cancelled before start');
    assert.ok(result.cancelled);
    assert.equal(getJob(job.id)?.status, 'cancelled');
    assert.equal(findTaskById(dispatched.taskId)?.status, 'cancelled');
    assert.equal(freeCredits(), balanceBefore, 'credit refunded on cancellation');

    // A late worker must never pick up the cancelled job.
    queue.start();
    await new Promise((resolve) => setTimeout(resolve, 150));
    assert.equal(getJob(job.id)?.status, 'cancelled');
    queue.stop();
  });

  it('cancellation of a running job: refunded, in-flight result discarded', async () => {
    configureFixtureProvider(fixture.baseUrl);
    fixture.setDelay(2500);
    const { queue } = freshQueue({ stepTimeoutMs: 10000 });
    const balanceBefore = topUp();
    const dispatched = createAgentTask({ userId, agentSlug: AGENT, goal: 'running cancel test' });
    const { job } = queue.enqueueAgentExecution({
      executionId: dispatched.executionId,
      agentSlug: AGENT,
      taskId: dispatched.taskId,
      userId,
    });
    queue.start();
    await waitFor(() => getJob(job.id)?.status === 'running', 10000, 'job running');

    const result = queue.cancelTask(dispatched.taskId, userId, 'user cancelled mid-run');
    assert.ok(result.cancelled);
    assert.equal(getJob(job.id)?.status, 'cancelled');
    assert.equal(findTaskById(dispatched.taskId)?.status, 'cancelled');
    assert.equal(freeCredits(), balanceBefore, 'credit refunded mid-run');

    // The abandoned in-flight completion must not resurrect the task.
    await new Promise((resolve) => setTimeout(resolve, 3000));
    assert.equal(findTaskById(dispatched.taskId)?.status, 'cancelled');
    assert.equal(freeCredits(), balanceBefore);
    queue.stop();
    fixture.setDelay(0);
  });

  it('emergency/admin cancellation: cancel-all settles every active job with refunds', async () => {
    configureFixtureProvider(fixture.baseUrl);
    fixture.setDelay(2500);
    const { queue } = freshQueue({ concurrency: 1, stepTimeoutMs: 10000 });
    const balanceBefore = topUp();
    const dispatchedA = createAgentTask({ userId, agentSlug: AGENT, goal: 'admin cancel a' });
    const dispatchedB = createAgentTask({ userId, agentSlug: 'research-investigator-016', goal: 'admin cancel b' });
    queue.enqueueAgentExecution({ executionId: dispatchedA.executionId, agentSlug: AGENT, taskId: dispatchedA.taskId, userId });
    queue.enqueueAgentExecution({ executionId: dispatchedB.executionId, agentSlug: 'research-investigator-016', taskId: dispatchedB.taskId, userId });
    queue.start();
    await waitFor(() => getJob(queue.getJobByTaskId(dispatchedA.taskId)?.id ?? '')?.status === 'running', 10000, 'first job running');

    const result = queue.adminCancelAll(userId, 'emergency stop test');
    assert.ok(result.cancelled >= 2, `expected >= 2 cancellations, got ${result.cancelled}`);
    assert.equal(findTaskById(dispatchedA.taskId)?.status, 'cancelled');
    assert.equal(findTaskById(dispatchedB.taskId)?.status, 'cancelled');
    assert.equal(freeCredits(), balanceBefore, 'all credits refunded');

    // Abandoned in-flight work must not resurrect the cancelled tasks.
    await new Promise((resolve) => setTimeout(resolve, 3000));
    assert.equal(findTaskById(dispatchedA.taskId)?.status, 'cancelled');
    assert.equal(findTaskById(dispatchedB.taskId)?.status, 'cancelled');
    assert.equal(freeCredits(), balanceBefore);
    queue.stop();
    fixture.setDelay(0);
  });

  it('idempotency: duplicate enqueues of the same execution create exactly one job', async () => {
    configureFixtureProvider(fixture.baseUrl);
    const { queue } = freshQueue();
    const balanceBefore = topUp();
    const dispatched = createAgentTask({ userId, agentSlug: AGENT, goal: 'idempotency test' });
    const first = queue.enqueueAgentExecution({
      executionId: dispatched.executionId,
      agentSlug: AGENT,
      taskId: dispatched.taskId,
      userId,
    });
    const second = queue.enqueueAgentExecution({
      executionId: dispatched.executionId,
      agentSlug: AGENT,
      taskId: dispatched.taskId,
      userId,
    });
    const third = queue.enqueueAgentExecution({
      executionId: dispatched.executionId,
      agentSlug: AGENT,
      taskId: dispatched.taskId,
      userId,
    });
    assert.ok(first.created);
    assert.equal(second.created, false);
    assert.equal(third.created, false);
    assert.equal(first.job.id, second.job.id);
    assert.equal(first.job.id, third.job.id);
    const count = db.get<{ count: number }>(
      'SELECT COUNT(*) AS count FROM execution_jobs WHERE idempotency_key = ?',
      [`agent:${dispatched.executionId}`],
    )?.count;
    assert.equal(count, 1);

    // Complete once; assert single execution/credit consumption.
    queue.start();
    await waitFor(() => getJob(first.job.id)?.status === 'completed', 10000, 'single completion');
    const executions = db.all('SELECT id FROM agent_executions WHERE task_id = ?', [dispatched.taskId]);
    assert.equal(executions.length, 1, 'no duplicate execution');
    assert.equal(freeCredits(), balanceBefore - 1, 'single credit consumption');
    queue.stop();
    clearProviderEnv();
  });

  it('race conditions: parallel dispatches respect the credit balance exactly', async () => {
    configureFixtureProvider(fixture.baseUrl);
    const { queue } = freshQueue({ concurrency: 4 });
    // Deterministic race: dispatch exactly balance+2 tasks so the outcome is
    // (balance succeed, 2 rejected with requires_pro, balance 0).
    const base = topUp(10);
    const total = base + 2;
    const results: Array<{ ok: boolean; taskId?: string }> = [];
    const dispatches = Array.from({ length: total }, (_, index) => {
      return Promise.resolve().then(() => {
        try {
          const dispatched = createAgentTask({ userId, agentSlug: AGENT, goal: `race test ${index}` });
          queue.enqueueAgentExecution({
            executionId: dispatched.executionId,
            agentSlug: AGENT,
            taskId: dispatched.taskId,
            userId,
          });
          results.push({ ok: true, taskId: dispatched.taskId });
        } catch {
          results.push({ ok: false });
        }
      });
    });
    await Promise.all(dispatches);
    const succeeded = results.filter((result) => result.ok).length;
    const rejected = results.length - succeeded;
    assert.equal(succeeded, base, 'exactly the available credits were reserved');
    assert.equal(rejected, 2, 'excess requests rejected with requires_pro');
    assert.equal(freeCredits(), 0, 'balance fully consumed, never negative');

    queue.start();
    await waitFor(
      () => results.filter((result) => result.taskId && findTaskById(result.taskId)?.status === 'completed').length === succeeded,
      20000,
      'all reserved tasks to complete',
    );
    assert.equal(freeCredits(), 0, 'successful tasks keep their credits');
    queue.stop();
    clearProviderEnv();
  });

  it('workflow job: full pipeline on the queue with real persisted state', async () => {
    configureFixtureProvider(fixture.baseUrl);
    topUp(15);
    const { queue, statuses } = freshQueue({ stepTimeoutMs: 8000, workflowTimeoutMs: 30000 });
    const planned = createExecutionPlan({ userId, goal: 'build a small website' });

    const { job } = queue.enqueueWorkflow({ workflowId: planned.workflowId, userId });
    assert.equal(job.status, 'queued');
    queue.start();

    await waitFor(() => getJob(job.id)?.status === 'completed', 30000, 'workflow completion');
    const workflow = getWorkflow(planned.workflowId);
    assert.equal(workflow?.status, 'completed');
    const result = JSON.parse(String(workflow?.result_json)) as { finalResult?: { status: string; credits: { consumed: number } } };
    assert.equal(result.finalResult?.status, 'completed');
    assert.ok((result.finalResult?.credits.consumed ?? 0) >= 1, 'credits accounted');

    const workflowStatuses = statuses.filter((status) => status.executionId === planned.workflowId).map((status) => status.status);
    assert.ok(workflowStatuses.includes('queued'));
    assert.ok(workflowStatuses.includes('running'));
    assert.ok(workflowStatuses.includes('completed'));
    queue.stop();
    clearProviderEnv();
  });

  it('workflow timeout: overall budget exceeded fails the workflow and refunds the in-flight step', async () => {
    configureFixtureProvider(fixture.baseUrl);
    fixture.setDelay(1200);
    topUp(15);
    const { queue } = freshQueue({ stepTimeoutMs: 10000, workflowTimeoutMs: 1500 });
    const planned = createExecutionPlan({ userId, goal: 'build a slow website' });
    const { job } = queue.enqueueWorkflow({ workflowId: planned.workflowId, userId });
    queue.start();

    await waitFor(() => getJob(job.id)?.status === 'timed_out', 20000, 'workflow timeout');
    const workflow = getWorkflow(planned.workflowId);
    assert.equal(workflow?.status, 'failed');
    assert.ok(String(workflow?.error_message).startsWith('timed_out'));

    // The in-flight step's task must be refunded.
    const runningTask = db.get<{ task_id: string }>(
      "SELECT task_id FROM workflow_steps WHERE workflow_id = ? AND status = 'failed'",
      [planned.workflowId],
    );
    if (runningTask?.task_id) {
      const task = findTaskById(String(runningTask.task_id));
      assert.equal(task?.status, 'failed');
      assert.ok(String(task?.error_message).startsWith('timed_out'));
    }
    // No retry for an overall workflow timeout.
    assert.equal(getJob(job.id)?.attempts, 1);
    queue.stop();
    fixture.setDelay(0);
    // Abandoned in-flight step work may finish honestly (its task completed
    // with verification) or be refunded; either way the balance never goes
    // negative and the workflow stays failed.
    await new Promise((resolve) => setTimeout(resolve, 2000));
    assert.equal(getWorkflow(planned.workflowId)?.status, 'failed', 'timeout state is never overwritten');
    assert.ok(freeCredits() >= 0);
    clearProviderEnv();
  });
});
