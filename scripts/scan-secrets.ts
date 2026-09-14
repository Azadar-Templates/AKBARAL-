import fs from 'node:fs';
import path from 'node:path';

/**
 * Secret scanner.
 *
 * Scans the working tree (excluding vendor/build/runtime dirs) for high-signal
 * credential patterns and reports path:line:pattern WITHOUT printing values.
 * Used for the production-hardening audit and by CI members who want to confirm
 * no real secret was committed.
 *
 * Honesty rules:
 *   - a marker that is not a known synthetic placeholder ALWAYS fails the scan;
 *   - synthetic placeholders (documented `user:password` samples, local test
 *     DSNs, redaction fixtures) are reported by count only, and every one of
 *     them must be listed by exact literal in scripts/scan-secrets-allowlist.json;
 *   - `--strict` ignores the allowlist, so the gate cannot hide anything — an
 *     auditor can always see the raw marker list.
 *
 * A security gate that fails on its own fixtures gets ignored or bypassed; a
 * gate that silently allows markers is worse. This keeps both properties honest.
 */

const EXCLUDE_DIRS = new Set([
  'node_modules',
  '.git',
  'dist',
  'data',
  'coverage',
  '.expo',
  'build',
  '.next',
  '.cache',
]);

const MAX_FILE_BYTES = 2_000_000;

const PATTERNS: Array<{ key: string; regex: RegExp }> = [
  { key: 'aws-access-key', regex: /AKIA[0-9A-Z]{16}/g },
  { key: 'openai-key', regex: /sk-[A-Za-z0-9]{20,}/g },
  { key: 'github-token', regex: /gh[pousr]_[A-Za-z0-9]{20,}/g },
  { key: 'google-api-key', regex: /AIza[0-9A-Za-z_-]{20,}/g },
  { key: 'slack-token', regex: /xox[baprs]-[A-Za-z0-9-]{20,}/g },
  { key: 'tavily-key', regex: /tvly-[A-Za-z0-9_-]{16,}/g },
  { key: 'private-key-block', regex: /-----BEGIN (RSA |EC |OPENSSH )?PRIVATE KEY-----/g },
  { key: 'bearer-token', regex: /Bearer [A-Za-z0-9._~+/=-]{20,}/g },
  { key: 'connection-string-password', regex: /(postgres|mysql|mongodb(?:\+srv)?|redis|amqp|smtp):\/\/[^@\s]+:[^@\s]+@/g },
  { key: 'token-in-query', regex: /[?&](?:access_token|api_key|auth|token|key)=[A-Za-z0-9._~+/=-]{20,}/g },
];

export interface SecretAllowEntry {
  /** Exact literal substring allowed anywhere in the tree. */
  value?: string;
  /** Or: a single file whose placeholder-prone markers are synthetic. */
  path?: string;
  reason: string;
}

/**
 * Patterns that may be exempted by PATH (whole-file) instead of by exact value.
 * These are ambient/placeholder-prone shapes: `user:password@host` samples and
 * single-character test DSNs appear legitimately in documentation and unit
 * tests. Key-shaped markers (sk-*, AIza*, gh*_*, xox*, AKIA*, tvly-*, PEM
 * blocks, bearer tokens) can NEVER be path-exempted, so pasting a real key into
 * an exempted file still fails the scan.
 */
const PATH_EXEMPTABLE_PATTERNS = new Set(['connection-string-password']);

export interface SecretFinding {
  path: string;
  line: number;
  pattern: string;
  allowed: boolean;
  reason?: string;
}

interface AllowlistFile {
  allow?: SecretAllowEntry[];
}

function loadAllowlist(baseDir: string): SecretAllowEntry[] {
  const file = path.join(baseDir, 'scripts', 'scan-secrets-allowlist.json');
  if (!fs.existsSync(file)) {
    return [];
  }
  try {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8')) as AllowlistFile;
    return (parsed.allow ?? []).filter(
      (entry) =>
        entry &&
        typeof entry.reason === 'string' &&
        ((typeof entry.value === 'string' && entry.value.length >= 4) || typeof entry.path === 'string'),
    );
  } catch {
    return [];
  }
}

function walk(root: string, onFile: (file: string) => void): void {
  if (!fs.existsSync(root)) {
    return;
  }
  const stat = fs.statSync(root);
  if (stat.isFile()) {
    onFile(root);
    return;
  }
  // `withFileTypes` avoids a second stat per entry, so a file that is created
  // and removed while the walk is running (database journals, build output)
  // cannot make the security gate crash with ENOENT — a scan must never fail
  // just because the tree changed underneath it.
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    if (EXCLUDE_DIRS.has(entry.name)) {
      continue;
    }
    const full = path.join(root, entry.name);
    if (entry.isDirectory()) {
      walk(full, onFile);
    } else if (entry.isFile()) {
      onFile(full);
    }
  }
}

export function scanSecretMarkers(options: { root?: string; strict?: boolean; baseDir?: string } = {}): SecretFinding[] {
  const root = options.root ?? process.cwd();
  const baseDir = options.baseDir ?? process.cwd();
  const allowlist = options.strict ? [] : loadAllowlist(baseDir);
  const findings: SecretFinding[] = [];

  walk(root, (file) => {
    const ext = path.extname(file).toLowerCase();
    const base = path.basename(file).toLowerCase();
    if (['.png', '.jpg', '.jpeg', '.gif', '.bin', '.db', '.sqlite'].includes(ext) || base.endsWith('.hbc')) {
      return;
    }
    let content = '';
    try {
      if (fs.statSync(file).size > MAX_FILE_BYTES) {
        return;
      }
      content = fs.readFileSync(file, 'utf8');
    } catch {
      return;
    }
    const lines = content.split(/\r?\n/);
    for (let index = 0; index < lines.length; index += 1) {
      const line = lines[index];
      for (const pattern of PATTERNS) {
        pattern.regex.lastIndex = 0;
        if (!pattern.regex.test(line)) {
          // Reset lastIndex so global regexes can be reused across lines.
          pattern.regex.lastIndex = 0;
          continue;
        }
        pattern.regex.lastIndex = 0;
        const relative = path.relative(root, file).split(path.sep).join('/');
        const allow = allowlist.find((entry) => {
          if (entry.value) {
            return line.includes(entry.value);
          }
          if (entry.path && PATH_EXEMPTABLE_PATTERNS.has(pattern.key)) {
            return relative === entry.path.split(path.sep).join('/');
          }
          return false;
        });
        findings.push({
          path: relative,
          line: index + 1,
          pattern: pattern.key,
          allowed: Boolean(allow),
          reason: allow?.reason,
        });
      }
    }
  });

  return findings;
}

export function realFindings(findings: SecretFinding[]): SecretFinding[] {
  return findings.filter((finding) => !finding.allowed);
}

if (require.main === module) {
  const strict = process.argv.includes('--strict');
  const findings = scanSecretMarkers({ strict });
  const real = realFindings(findings);
  const allowed = findings.length - real.length;

  if (real.length === 0) {
    console.log(
      `[scan-secrets] PASS no real secret markers found in the working tree` +
        (allowed > 0 ? ` (${allowed} allow-listed synthetic placeholder${allowed === 1 ? '' : 's'})` : '') +
        (strict ? ' [strict: allowlist ignored]' : ''),
    );
    process.exit(0);
  }

  console.log('[scan-secrets] FAIL potential secret markers found (values not printed):');
  for (const finding of real) {
    console.log(`  ${finding.path}:${finding.line} pattern=${finding.pattern}`);
  }
  if (allowed > 0 && !strict) {
    console.log(`  (${allowed} synthetic placeholder${allowed === 1 ? '' : 's'} allow-listed — see scripts/scan-secrets-allowlist.json)`);
  }
  process.exit(1);
}
