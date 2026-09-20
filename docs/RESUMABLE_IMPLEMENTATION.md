# Durable implementation checkpoints

Repository files and commits are the implementation state. Preview URLs, dev servers,
terminal sessions and Arena messages are not checkpoints. Never reset the repository
or delete a previous test run to recover from an interruption.

## Resume procedure

1. Run `git status --short`, `git log -6 --oneline` and `npm run test:status`.
2. Inspect `docs/IMPLEMENTATION_PROGRESS.md`; do not restart already completed historical suites.
3. Finish and commit a logical code change, including its focused regressions, before
   starting an integrated run. Push only `arena/01a0ba0a-akbaral`.
4. Run `npm run test:batch -- --batch-size 8`. Repeat the **same command** after each
   successful batch. `npm test` runs every remaining file with the same checkpoints.
5. After an Arena failure or command timeout, rerun that command. Only unfinished
   files are retried, starting from the last successful immutable database snapshot.
6. A batch exit of zero is **not a full-suite pass**. Only `complete: true` means all
   discovered test files have completed. Review skipped/todo counts separately.

## Evidence and boundaries

- Test files are sorted deterministically. Every file receives a private attempt DB
  cloned from the previous successful snapshot, preserving the original ordered,
  shared-fixture suite semantics without inheriting a failed attempt's writes.
- `logs/test-checkpoints/<fingerprint>/checkpoint.json` is atomically renamed and
  fsynced after each file. Successful TAP logs and SQLite snapshots are checksummed;
  corrupted evidence cannot be silently reused. Failed attempts remain available.
- Runs are keyed by code/migration/test/asset/configuration hashes, dependency lock,
  Node version/platform and relevant environment hashes. **No environment values are
  written to the manifest.** Docs-only changes and commits of unchanged sources do
  not invalidate progress. Code/configuration changes start a separate run; they are
  never combined with old results into a fabricated full-suite pass.
- Each child has a default 180-second deadline. `--timeout-ms 300000` can increase it
  without rerunning successful files. SIGTERM/SIGINT terminate the child process
  group; SIGKILL/session loss leaves an unfinished attempt, not a success marker.
- An OS-held SQLite mutex prevents concurrent writers and automatically releases
  after a crash. A live orphan blocks resumption until it exits or its persisted deadline expires;
  an identity-matched expired orphan is terminated before retrying. Runner metadata
  also distinguishes PID reuse across boots. No preview process is required.
- `--run-dir logs/test-checkpoints/my-run` selects an explicit retained run. A source
  fingerprint mismatch fails closed; choose another directory for changed sources.
- These runtime checkpoints are ignored by Git but persist in this workspace. Commits
  preserve code/runbooks, not databases. Workspace destruction still requires external
  backup; a Git commit alone cannot restore local runtime data or unpushed evidence.
  CI uploads checkpoint evidence with `always()` when its artifact step can run;
  a forcibly destroyed runner cannot guarantee a final artifact upload.
- Test fixtures that already select their own isolated DB continue to do so. Checkpoints
  cover the ordered shared SQLite fixture; they do not claim browser, payment, provider
  or deployment verification, nor complete portability of all test-generated files.

At an interruption-safe checkpoint report only:

- Commit SHA
- Tests passed (batch or whole suite, labelled accurately)
- Next exact task

### Optional disk-safe verification retention

Use `npm test -- --prune-working-copies` on storage-constrained sandboxes.
After each test subprocess has completed successfully, the runner saves its
immutable `passed.db` and TAP hashes/checkpoint, verifies them again, and removes
only that subprocess's redundant mutable `working.db`. Failed/interrupted DBs,
all verification snapshots, logs, checkpoint metadata and source are preserved.
Resume still checks every snapshot/log hash and skips completed tests. This flag
changes retention of disposable copies only, not test coverage or pass criteria.
