/**
 * ZA141251SA — set (or rotate) the private Mission owner password.
 *
 *   npm run mission:set-owner-password
 *
 * WHY THIS SCRIPT EXISTS
 * ----------------------
 * `npm run mission:init` provisions the owner from ZA141251SA_OWNER_PASSWORD.
 * That is convenient for a first bootstrap but it means the plaintext password
 * lives in an environment file for as long as that file exists. This script
 * removes that exposure: the secret is read from STDIN only, so it never
 * appears in
 *
 *   · the shell history or the process argv table (visible to `ps`),
 *   · any .env / secrets file committed or left on disk,
 *   · application logs, audit details, screenshots, tests or fixtures,
 *   · the chat transcript of whoever operates the deployment.
 *
 * What is persisted is ONLY the scrypt hash written by provisionOwner()
 * (`scrypt$16384$8$1$<salt>$<hash>`, src/mission/auth.ts) into the mission
 * database. Plaintext is zero-filled from the buffer as soon as it is hashed.
 *
 * The single-identity lock still applies: provisionOwner() refuses any email
 * other than the configured ZA141251SA_OWNER_EMAIL, so this script cannot be
 * used to mint a second owner.
 *
 * Usage:
 *   printf '%s' 'the-password' | npm run mission:set-owner-password     # piped
 *   npm run mission:set-owner-password                                  # prompt
 *
 * Optional flags:
 *   --email <address>   override ZA141251SA_OWNER_EMAIL (must still match the
 *                       configured identity when the lock is enabled)
 */
import { createInterface } from 'node:readline';
import { missionDb, applyMissionMigrations, missionEnv } from '../src/mission/database';
import { provisionOwner, ownerCount } from '../src/mission/auth';
import {
  configuredMissionOwnerEmail,
  enforceIdentityLock,
  identityLockEnabled,
  identityLockStatus,
  identityLockVerified,
} from '../src/mission/identity-lock';

const MIN_LENGTH = 12;

function arg(name: string): string | null {
  const index = process.argv.indexOf(name);
  if (index === -1) return null;
  const value = process.argv[index + 1];
  return value && !value.startsWith('--') ? value : null;
}

/** Read one line from stdin without echoing it when a terminal is attached. */
async function readSecret(prompt: string): Promise<string> {
  if (!process.stdin.isTTY) {
    const chunks: Buffer[] = [];
    for await (const chunk of process.stdin) chunks.push(Buffer.from(chunk));
    return Buffer.concat(chunks).toString('utf8').replace(/\r?\n$/, '');
  }
  const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: true });
  const output = process.stdout as NodeJS.WriteStream & { muted?: boolean };
  // Suppress the echo of typed characters — the prompt itself still prints.
  const write = output.write.bind(output);
  (rl as unknown as { _writeToOutput: (value: string) => void })._writeToOutput = (value: string) => {
    if (value.includes(prompt)) write(value);
  };
  const answer = await new Promise<string>((resolve) => rl.question(prompt, resolve));
  rl.close();
  write('\n');
  return answer;
}

async function main(): Promise<void> {
  applyMissionMigrations();

  const email = (arg('--email') ?? configuredMissionOwnerEmail() ?? '').trim().toLowerCase();
  if (!email) {
    process.stderr.write(
      'No owner email configured. Set ZA141251SA_OWNER_EMAIL (the single permitted identity) or pass --email.\n',
    );
    process.exit(2);
  }

  const password = await readSecret('New ZA141251SA owner password (input hidden): ');
  if (password.length < MIN_LENGTH) {
    // Never echo the value or its content — only the policy that was violated.
    process.stderr.write(`Refused: the owner password must be at least ${MIN_LENGTH} characters.\n`);
    process.exit(2);
  }
  if (process.stdin.isTTY) {
    const confirmation = await readSecret('Repeat the password: ');
    if (confirmation !== password) {
      process.stderr.write('Refused: the two entries did not match.\n');
      process.exit(2);
    }
  }

  const existed = Boolean(missionDb.get('SELECT id FROM mission_owner WHERE email = ?', [email]));
  const owner = provisionOwner({ email, password });

  // Single-identity lockdown runs immediately so any account that is not the
  // configured identity is suspended and its sessions revoked.
  const lock = enforceIdentityLock();
  const verified = identityLockVerified();
  const status = identityLockStatus();

  process.stdout.write('\nZA141251SA owner credential updated\n');
  process.stdout.write(`  database             ${missionDb.path()}\n`);
  process.stdout.write(`  owner                ${owner.email} (${existed ? 'password rotated' : 'account created'})\n`);
  process.stdout.write('  stored as            scrypt hash (N=16384, r=8, p=1, 16-byte salt) — plaintext is never persisted\n');
  process.stdout.write(`  owner accounts       ${ownerCount()}\n`);
  process.stdout.write(
    `  identity lockdown    ${
      identityLockEnabled()
        ? verified.ok
          ? `ENFORCED — only ${email} may authenticate (${lock.swept ? 'sweep ran now' : 'already enforced'})`
          : `FAILED — ${verified.reason}`
        : 'OFF — set ZA141251SA_OWNER_EMAIL to restrict authentication to one identity'
    }\n`,
  );
  process.stdout.write(`    accounts suspended ${status.ownersSuspended}\n`);
  process.stdout.write(`    sessions revoked   ${status.sessionsRevoked}\n`);
  process.stdout.write(`    links revoked      ${status.linksRevoked}\n`);
  process.stdout.write(`  currency             ${missionEnv().currency}\n`);
  process.stdout.write('\nRestart `npm run mission:serve` if it is running, then sign in at the private dashboard.\n\n');
}

main().catch((error) => {
  process.stderr.write(`\nmission:set-owner-password failed: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
});
