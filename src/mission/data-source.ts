/**
 * ZA141251SA DATA SOURCE — which database a verdict was actually read from, and whether that
 * database is allowed to speak about production.
 *
 * The failure this closes is a reporting one, and it is easy to commit by accident: an operator runs
 * a readiness command against a scratch or test database (a `DATA_DIR` under /tmp, a `node:sqlite`
 * fixture, a pglite harness), reads "0 verified payout slots" or "no platform credential" in the
 * output, and quotes it back as the state of the deployment. It was never the deployment — it was a
 * file in a temp directory that happened to share the schema.
 *
 * So every production-shaped claim carries a source mark:
 *
 *   PRODUCTION                 the real, non-scratch database on a production host
 *   LOCAL / NOT PRODUCTION     a developer's own checkout — real rows, wrong authority
 *   FIXTURE / NOT PRODUCTION   a scratch/temp/fixture database — the numbers are test artifacts
 *
 * Classification fails closed: an unrecognized path is `local`, never `production`, because only an
 * explicit production signal plus the documented production volume can earn that claim, and an
 * explicit fixture override always wins. A report can understate its own authority; it cannot
 * overstate it.
 */

import os from 'node:os';
import path from 'node:path';
import { resolveMissionDbPath } from './database';

export type MissionDataKind = 'production' | 'local' | 'fixture';

export const PRODUCTION_CLAIM_MARK = 'PRODUCTION';
export const LOCAL_CLAIM_MARK = 'LOCAL / NOT PRODUCTION';
export const FIXTURE_CLAIM_MARK = 'FIXTURE / NOT PRODUCTION';

/** Directory prefixes that can only be scratch space on a normal host. */
const SCRATCH_PREFIXES = ['/tmp', '/var/tmp', '/private/tmp', '/private/var/tmp', '/dev/shm', '/run/user'];

/** Path fragments that mark a database as a test/fixture artifact by construction. */
const SCRATCH_MARKERS = ['.pglite', '/fixtures/', '/fixture-', '/scratch', 'node_modules', '/.next/', '/dist/'];

/** File names that are obviously synthetic wherever they live. */
const SCRATCH_BASENAMES: RegExp[] = [/mission[-_]test/i, /fixture/i, /synthetic/i, /preflight/i, /strip-sim/i, /[-_]test[-_]/i];

/** The volume a production deployment mounts, per .env.example and src/mission/database.ts. */
const PRODUCTION_DATA_ROOT = '/data';

export interface MissionDataSource {
  kind: MissionDataKind;
  /** The mark every production-shaped claim in a verdict carries. */
  label: string;
  /**
   * What was read. For SQLite, the resolved file path. For a managed database, only the scheme: a
   * DSN can embed a password, and a verdict field is a disclosure surface.
   */
  source: string;
  engine: 'sqlite' | 'postgres';
  /** Only a production source may assert production state. */
  productionClaimsAllowed: boolean;
  /** Every rule that fired, so the classification itself is auditable. */
  reasons: string[];
}

function normalize(candidate: string): string {
  return path.resolve(candidate).replace(/\/+$/, '');
}

/** True when `child` sits inside `parent` (normalized absolute-path prefix comparison). */
function isInside(child: string, parent: string): boolean {
  const base = normalize(parent);
  return base.length > 1 && (child === base || child.startsWith(`${base}/`));
}

export function claimMarkFor(kind: MissionDataKind): string {
  if (kind === 'production') return PRODUCTION_CLAIM_MARK;
  return kind === 'fixture' ? FIXTURE_CLAIM_MARK : LOCAL_CLAIM_MARK;
}

/** The database URL the environment points at, using the same default as `missionEnv()`. */
function databaseUrlFrom(env: Readonly<Record<string, string | undefined>>): string {
  const raw = String(env.ZA141251SA_DATABASE_URL ?? env.MISSION_DATABASE_URL ?? '').trim();
  if (raw.length > 0) return raw;
  const production = String(env.NODE_ENV ?? '').trim().toLowerCase() === 'production';
  const dataDir = String(env.DATA_DIR ?? (production ? PRODUCTION_DATA_ROOT : './data')).trim() || './data';
  return `file:${path.join(dataDir, 'mission.db')}`;
}

/**
 * Classify the database the given environment points at. Pure: reads only the env object it is
 * handed, mutates nothing, opens no connection — so a test can ask the same question about any path.
 */
export function classifyMissionDataSource(env: Readonly<Record<string, string | undefined>> = process.env): MissionDataSource {
  const databaseUrl = databaseUrlFrom(env);
  const isFileUrl = databaseUrl.startsWith('file:');
  const reasons: string[] = [];
  const explicitFixture = ['1', 'true', 'yes'].includes(String(env.ZA141251SA_DATA_IS_FIXTURE ?? '').trim().toLowerCase());

  let kind: MissionDataKind;
  let source: string;
  let engine: 'sqlite' | 'postgres';

  if (!isFileUrl) {
    engine = 'postgres';
    source = `${databaseUrl.split('://')[0] ?? 'managed'}://<url not printed>`;
    kind = 'local';
    reasons.push('a managed database URL is configured; a path rule cannot classify its contents, so no production claim is made from here');
  } else {
    engine = 'sqlite';
    const resolved = normalize(resolveMissionDbPath(databaseUrl));
    source = resolved;
    const underTemp = [os.tmpdir(), ...SCRATCH_PREFIXES].some(root => root.length > 0 && isInside(resolved, normalize(root)));
    const markerHit = SCRATCH_MARKERS.find(marker => resolved.toLowerCase().includes(marker));
    const basenameHit = SCRATCH_BASENAMES.find(pattern => pattern.test(path.basename(resolved)));
    if (underTemp) reasons.push(`path is inside a temp root (${normalize(os.tmpdir())})`);
    if (markerHit) reasons.push(`path contains the scratch marker "${markerHit}"`);
    if (basenameHit) reasons.push(`file name matches a synthetic-database pattern (${String(basenameHit)})`);
    kind = underTemp || markerHit || basenameHit ? 'fixture' : 'local';
  }

  if (explicitFixture) {
    kind = 'fixture';
    reasons.push('ZA141251SA_DATA_IS_FIXTURE forces fixture classification; it can only lower authority');
  }

  const productionSignalled = String(env.NODE_ENV ?? '').trim().toLowerCase() === 'production';
  if (kind === 'local') {
    const onProductionVolume = isFileUrl && isInside(normalize(resolveMissionDbPath(databaseUrl)), PRODUCTION_DATA_ROOT);
    if (productionSignalled && onProductionVolume) {
      kind = 'production';
      reasons.push(`NODE_ENV=production and the database lives under ${PRODUCTION_DATA_ROOT}, the documented production volume`);
    } else if (productionSignalled) {
      reasons.push(`NODE_ENV=production but the database is not under ${PRODUCTION_DATA_ROOT}: not enough to claim production`);
    } else {
      reasons.push('neither a production host nor a scratch path — reported as local, which cannot assert production state either');
    }
  } else if (kind === 'fixture') {
    reasons.push('scratch/fixture origin: no field of this verdict may be quoted as production state');
  }

  return { kind, label: claimMarkFor(kind), source, engine, productionClaimsAllowed: kind === 'production', reasons };
}

/**
 * The guard used wherever a production-shaped claim or a production-only mutation would otherwise
 * proceed. Returns the refusal reason, or null when the claim is allowed.
 */
export function productionClaimRefusal(dataSource: MissionDataSource, what = 'this claim'): string | null {
  if (dataSource.productionClaimsAllowed) return null;
  return `refused: ${what} cannot be stated as production state while the verdict reads ${dataSource.source} (${dataSource.label})`;
}
