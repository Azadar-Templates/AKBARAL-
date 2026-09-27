/**
 * ZA141251SA mission server entry — `npm run mission:serve`
 *
 * Thin development wrapper: the real bootstrap lives in `src/mission/serve.ts`
 * so the compiled production entry (`dist/src/mission/serve.js`, also reachable
 * as `AKBARAL_ROLES=mission` in scripts/start-prod.mjs) and this tsx script can
 * never drift apart.
 */
import { serveMission } from '../src/mission/serve';

serveMission().catch((error) => {
  process.stderr.write(`mission:serve failed: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
});
