#!/usr/bin/env sh
# AKBARAL! / MASTER AI — container entrypoint (Milestone 10; StackHost
# startup fix, 2026-09-17; StackHost sh-disallow fix, 2026-09-17).
#
# `set -e` used to mean that ANY early step failing (a partial build, a
# missing dependency, migrations run before the build even produced
# dist/src/db/migrate.js) killed the shell immediately — and because that
# happened 2-3 seconds after the container started, before Node had printed
# a single line, the platform saw a silent exit with no application logs.
#
# The corrected contract:
#   - migrations, the optional seed step, the build preflight, SESSION_SECRET
#     handling, and the nightly backup scheduler all live in
#     scripts/start-prod.mjs now, so there is exactly one place that decides
#     "are we ready to start" and it always prints WHY before it gives up.
#     StackHost now explicitly rejects `sh` in stackhost.yaml, so that file
#     uses `node scripts/start-prod.mjs` directly.
#   - this script is the Docker/Modal entrypoint and its only job is to
#     `exec` the Node wrapper as the FINAL statement, so the wrapper replaces
#     this shell (correct signal handling) and its exit code is the
#     container's exit code — it can never "silently exit" underneath it.
#     The backup loop previously lived here; it now lives in start-prod.mjs
#     so StackHost's direct Node start also gets it without `sh`.
set -eu

echo "[akbaral] starting production stack (scripts/start-prod.mjs applies migrations,"
echo "[akbaral] verifies build artifacts, then starts the API + web tiers; the"
echo "[akbaral] next logs come from that wrapper)"
# `exec` replaces this shell with the Node process: the startup wrapper is the
# real PID 1 payload, so a crash there is a container exit with a real log
# trail — not a shell falling off the end silently.
exec node scripts/start-prod.mjs
