/** Synthetic SQLite contention fixture. Never invoked by application runtime. */
import { missionDb } from '../../src/mission/database';
import { reserveResourceCall, claimResourceCall, type ReserveResourceCall } from '../../src/mission/resource-calls';
import { MissionSelfServiceError } from '../../src/mission/self-management';
const input = JSON.parse(process.env.QUOTA_RACE_FIXTURE ?? '{}') as ReserveResourceCall & { callId?: string };
const original = missionDb.get.bind(missionDb);
let delayed = false;
missionDb.get = ((sql: string, params?: Parameters<typeof missionDb.get>[1]) => {
  const value = original(sql, params);
  if (!delayed && sql.includes('SELECT * FROM mission_resource')) {
    delayed = true;
    // Hold the real write transaction so another independent connection contends.
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 150);
  }
  return value;
}) as typeof missionDb.get;
const watchdog = setTimeout(() => process.exit(2), 12000);
process.once('message', () => {
  try {
    const row = input.callId ? claimResourceCall(input.callId, input) : reserveResourceCall(input);
    process.send?.({ phase: 'result', ok: true, id: input.callId ?? (row as { id: string }).id });
  } catch (error) {
    process.send?.({ phase: 'result', ok: false, code: error instanceof MissionSelfServiceError ? error.code : 'unexpected', error: error instanceof Error ? error.message : 'unexpected error' });
  } finally { clearTimeout(watchdog); missionDb.close(); process.disconnect(); }
});
process.send?.({ phase: 'ready' });
