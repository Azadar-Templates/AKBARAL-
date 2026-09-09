import fs from 'node:fs';
import path from 'node:path';

/**
 * Secret scanner.
 *
 * Scans the working tree (excluding vendor/build/runtime dirs) for high-signal
 * credential patterns and reports path:line:pattern WITHOUT printing values.
 * Used for the production-hardening audit and by CI members who want to confirm
 * no real secret was committed.
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

const PATTERNS: Array<{ key: string; regex: RegExp }> = [
  { key: 'aws-access-key', regex: /AKIA[0-9A-Z]{16}/g },
  { key: 'openai-key', regex: /sk-[A-Za-z0-9]{20,}/g },
  { key: 'github-token', regex: /gh[pousr]_[A-Za-z0-9]{20,}/g },
  { key: 'google-api-key', regex: /AIza[0-9A-Za-z_-]{20,}/g },
  { key: 'slack-token', regex: /xox[baprs]-[A-Za-z0-9-]{20,}/g },
  { key: 'private-key-block', regex: /-----BEGIN (RSA |EC |OPENSSH )?PRIVATE KEY-----/g },
  { key: 'bearer-token', regex: /Bearer [A-Za-z0-9._~+/=-]{20,}/g },
  { key: 'connection-string-password', regex: /(postgres|mysql|mongodb(?:\+srv)?|redis|amqp|smtp):\/\/[^@\s]+:[^@\s]+@/g },
  { key: 'token-in-query', regex: /[?&](?:access_token|api_key|auth|token|key)=[A-Za-z0-9._~+/=-]{20,}/g },
];

function walk(root: string, onFile: (file: string) => void): void {
  if (!fs.existsSync(root)) {
    return;
  }
  const stat = fs.statSync(root);
  if (stat.isFile()) {
    onFile(root);
    return;
  }
  for (const entry of fs.readdirSync(root)) {
    if (EXCLUDE_DIRS.has(entry)) {
      continue;
    }
    const full = path.join(root, entry);
    const st = fs.statSync(full);
    if (st.isDirectory()) {
      walk(full, onFile);
    } else {
      onFile(full);
    }
  }
}

export function scanSecretMarkers(): Array<{ path: string; line: number; pattern: string }> {
  const findings: Array<{ path: string; line: number; pattern: string }> = [];
  walk(process.cwd(), (file) => {
    const ext = path.extname(file).toLowerCase();
    const base = path.basename(file).toLowerCase();
    if (['.png', '.jpg', '.jpeg', '.gif', '.bin', '.db', '.sqlite'].includes(ext) || base.endsWith('.hbc')) {
      return;
    }
    let content = '';
    try {
      content = fs.readFileSync(file, 'utf8');
    } catch {
      return;
    }
    const lines = content.split(/\r?\n/);
    for (let index = 0; index < lines.length; index += 1) {
      const line = lines[index];
      for (const pattern of PATTERNS) {
        if (pattern.regex.test(line)) {
          // Reset lastIndex so global regexes can be reused across lines.
          pattern.regex.lastIndex = 0;
          findings.push({ path: path.relative(process.cwd(), file), line: index + 1, pattern: pattern.key });
        }
      }
    }
  });
  return findings;
}

if (require.main === module) {
  const findings = scanSecretMarkers();
  if (findings.length === 0) {
    console.log('[scan-secrets] PASS no high-signal secret markers found in the working tree');
    process.exit(0);
  }
  console.log('[scan-secrets] FAIL potential secret markers found (values not printed):');
  for (const finding of findings) {
    console.log(`  ${finding.path}:${finding.line} pattern=${finding.pattern}`);
  }
  process.exit(1);
}
