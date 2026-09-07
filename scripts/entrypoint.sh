#!/usr/bin/env sh
set -eu

echo "[akbaral] applying database migrations"
node dist/src/db/migrate.js

if [ "${SEED_DATABASE:-false}" = "true" ]; then
  echo "[akbaral] seeding registry + plans"
  node dist/src/db/seed.js
fi

echo "[akbaral] starting API"
exec node dist/src/index.js
