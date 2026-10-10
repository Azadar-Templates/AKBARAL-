/**
 * ZA141251SA GITHUB CREDENTIAL — the single place a GitHub token is looked up.
 *
 * Before this module existed, three disjoint reader sets each had their own idea of where the
 * token lives: the bounty client and the backend report read `ZA141251SA_GITHUB_TOKEN`, the
 * opportunity ingestion and two operator scripts read `GITHUB_TOKEN ?? GH_TOKEN`, and the
 * connector registry declares `GITHUB_TOKEN`. The owner could therefore set one variable in the
 * host and have half the mission see it. That is a silent-divergence bug of exactly the kind
 * this file exists to end.
 *
 * Precedence (highest first) — first NON-BLANK value wins, and a set-but-empty variable falls
 * through to the next name so a stray `GITHUB_TOKEN=""` cannot shadow a real credential:
 *
 *   1. ZA141251SA_GITHUB_TOKEN   authoritative: mission-namespaced, documented in .env.example
 *   2. GITHUB_TOKEN             backwards compatible (generic GitHub CLI / CI name)
 *   3. GH_TOKEN                 backwards compatible (GitHub CLI's own name)
 *
 * The two scopes are the whole policy, and they are the only difference between a read path and a
 * write path in the mission:
 *
 *   'read'   discovery, connector presence, operator reports — the full precedence above, so the
 *            compatible names the mission already honoured keep working.
 *   'write'  anything that can act as the owner on GitHub (the bounty client, which forks, pushes
 *            and opens pull requests) — the authoritative name ONLY. An ambient CI `GITHUB_TOKEN` is
 *            not an owner opt-in, and writing pull requests with one silently would hand someone
 *            else's identity to this mission; that refusal is asserted by github-bounty-client.test.ts.
 *
 * Nothing else in the tree may read those variables directly; it calls `resolveGithubToken`
 * for the value or `githubCredentialStatus` for presence.
 *
 * The value is a secret: this module never logs it, never returns it from a status/verdict
 * object, never reports its length, never shows a prefix or a fingerprint, and never writes it
 * into an audit row. Presence and the winning NAME are the only facts on offer.
 */

/** The accepted environment names, in the precedence order the whole mission uses. */
export const GITHUB_TOKEN_ENV_NAMES = ['ZA141251SA_GITHUB_TOKEN', 'GITHUB_TOKEN', 'GH_TOKEN'] as const;

export type GithubTokenEnvName = (typeof GITHUB_TOKEN_ENV_NAMES)[number];

/** The variable the owner is told to set; the other two are honoured for compatibility only. */
export const GITHUB_TOKEN_AUTHORITATIVE_ENV: GithubTokenEnvName = 'ZA141251SA_GITHUB_TOKEN';

/** What the bounty worker needs from a classic personal access token: read/push on the fork and
 * the pull request against upstream. Nothing else is authorized by a token that has these. */
export const GITHUB_TOKEN_REQUIRED_SCOPES = ['repo', 'workflow'] as const;

/** Which names a caller may resolve: read-only paths or write-capable paths. */
export type GithubCredentialScope = 'read' | 'write';

/** The names a given scope may resolve. One place decides, so every reader agrees. */
export function acceptedGithubTokenEnvNames(scope: GithubCredentialScope = 'read'): readonly GithubTokenEnvName[] {
  return scope === 'write' ? [GITHUB_TOKEN_AUTHORITATIVE_ENV] : GITHUB_TOKEN_ENV_NAMES;
}

export interface GithubCredentialStatus {
  /** The policy this was evaluated under. */
  scope: GithubCredentialScope;
  /** True when one of the names accepted for that scope holds a non-blank value. */
  present: boolean;
  /** Which name answered, or null when none did. A name, never a value. */
  source: GithubTokenEnvName | null;
  /** The precedence list, so a report can show what it looked for. */
  acceptedNames: readonly GithubTokenEnvName[];
  requiredScopes: readonly string[];
  /** Fixed wording; contains no data from the environment. */
  note: string;
}

function blankToNull(value: string | undefined): string | null {
  if (typeof value !== 'string') return null;
  return value.trim().length > 0 ? value : null;
}

/**
 * The ONLY resolver. Returns the winning token value for a caller that must put it in an
 * `Authorization` header, or null. Prefer `githubCredentialStatus` anywhere the value is not
 * actually needed — a report never needs a secret.
 */
export function resolveGithubToken(
  env: Readonly<Record<string, string | undefined>> = process.env,
  options: { scope?: GithubCredentialScope } = {},
): string | null {
  for (const name of acceptedGithubTokenEnvNames(options.scope ?? 'read')) {
    const value = blankToNull(env[name]);
    if (value !== null) return value;
  }
  return null;
}

/**
 * Presence + winning name, computed without ever exposing the value. Deliberately narrow: there is
 * no field here that could carry a token, a length or a prefix, so a caller cannot leak by
 * serializing this object.
 */
export function githubCredentialStatus(
  env: Readonly<Record<string, string | undefined>> = process.env,
  options: { scope?: GithubCredentialScope } = {},
): GithubCredentialStatus {
  const scope: GithubCredentialScope = options.scope ?? 'read';
  const acceptedNames = acceptedGithubTokenEnvNames(scope);
  let source: GithubTokenEnvName | null = null;
  for (const name of acceptedNames) {
    if (blankToNull(env[name]) !== null) {
      source = name;
      break;
    }
  }
  return {
    scope,
    present: source !== null,
    source,
    acceptedNames,
    requiredScopes: GITHUB_TOKEN_REQUIRED_SCOPES,
    note: source === null
      ? `no credential accepted for scope '${scope}' — set ${GITHUB_TOKEN_AUTHORITATIVE_ENV} (classic PAT, GitHub scopes: ${GITHUB_TOKEN_REQUIRED_SCOPES.join(', ')})`
      : `present via ${source} (scope '${scope}'; name only — the value is never read, logged, sized or hashed here)`,
  };
}

/**
 * One-line rendering for logs and the readiness report. Built from `githubCredentialStatus`, so
 * no code path can print the value by using this helper.
 */
export function githubCredentialLine(
  env: Readonly<Record<string, string | undefined>> = process.env,
  options: { scope?: GithubCredentialScope } = {},
): string {
  const status = githubCredentialStatus(env, options);
  return status.present
    ? `present (name: ${status.source}; scope ${status.scope}; value never read)`
    : `absent (set ${GITHUB_TOKEN_AUTHORITATIVE_ENV}; none of ${status.acceptedNames.join(', ')} is set)`;
}

/**
 * True when `name` is one of the GitHub credential names, so a table of per-connector env var
 * declarations (the provider registry) can resolve presence through this module instead of
 * reading a single name and calling it authoritative.
 */
export function isGithubTokenEnvName(name: string): name is GithubTokenEnvName {
  return (GITHUB_TOKEN_ENV_NAMES as readonly string[]).includes(name);
}
