import fs from 'node:fs';
import path from 'node:path';

const escapeCommand = text => String(text).replaceAll('%', '%25').replaceAll('\r', '%0D').replaceAll('\n', '%0A');

/** Keep a useful failure annotation available through the GitHub Checks API even
 * when signed Actions log/artifact download endpoints are unreachable. No env or
 * configuration values are read or included in this diagnostic. */
export function failureDiagnostic(directory, fallback) {
  try {
    const state = JSON.parse(fs.readFileSync(path.join(directory, 'checkpoint.json'), 'utf8'));
    const failed = state.attempts.filter(attempt => attempt.status !== 'passed').at(-1);
    if (!failed) return { annotation: `::error title=SQLite checkpoint failure::${escapeCommand(fallback)}`, summary: String(fallback) };
    const log = fs.readFileSync(failed.log, 'utf8');
    const details = log.split('\n').filter(line => /not ok|failureType:|error:|expected:|actual:|location:|ERR_ASSERTION/.test(line)).slice(0, 25).join('\n').slice(0, 3000);
    const completed = state.attempts.filter(attempt => attempt.status === 'passed').length;
    const summary = `${completed}/${state.files.length} files checkpointed. Failed file: ${failed.file}\n${failed.error ?? fallback}\n${details}`;
    return { annotation: `::error title=SQLite regression failure::${escapeCommand(summary)}`, summary };
  } catch { return { annotation: `::error title=SQLite checkpoint failure::${escapeCommand(fallback)}`, summary: String(fallback) }; }
}
