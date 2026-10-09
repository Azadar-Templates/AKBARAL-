# AKBARAL! / MASTER AI — production image (Milestone 10).
#
# Single-node production: Next.js (:3000, premium homepage + SPA, /api and
# /uploads rewritten to the API) and the Express API (:4000) in one
# container over a shared /data volume (SQLite + uploads + backups).
# Horizontal scaling is intentionally NOT claimed — see docs/DEPLOYMENT.md
# for the honest single-node scaling story and the POST-LAUNCH PostgreSQL
# migration path.

FROM node:22-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json tsconfig.backend.json next.config.mjs ./
COPY src ./src
COPY db ./db
COPY public ./public
# scripts/ is NOT optional for the build: tsconfig.backend.json compiles
# scripts/**/*.ts, and Next's type-check phase type-checks the test files that
# import from scripts/ (src/security/scan-secrets.test.ts imports
# ../../scripts/scan-secrets). Without it `npm run build` fails with
# "Failed to type check" (TS2307) and the image is never produced.
COPY scripts ./scripts
RUN npm run build

FROM node:22-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production
ENV DATA_DIR=/data
ENV AKBARAL_UPLOAD_DIR=/data/uploads
ENV DATABASE_URL=file:/data/akbaral.db
ENV ZA141251SA_DATABASE_URL=file:/data/mission.db
ENV HOST=0.0.0.0
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates postgresql-client && rm -rf /var/lib/apt/lists/*
# Blitz fix (2026-09-22): blitz.cloud runs as user 1000:1000 with all caps dropped, never as root.
# The image must be writable by 1000, otherwise /data/akbaral.db open fails with SQLITE_CANTOPEN
# and the container shows Internal Server Error with no useful log.
# /app is read-only application code; /data is the writable persistent volume.
RUN mkdir -p /data/uploads /data/backups && chown -R 1000:1000 /data && chmod -R 777 /data && chown -R 1000:1000 /app && chmod -R 755 /app
VOLUME ["/data"]
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/.next ./.next
COPY package.json next.config.mjs ./
COPY db ./db
COPY public ./public
COPY scripts ./scripts
# mission-dashboard/ is REQUIRED at runtime: the private mission server serves
# its dashboard shell from it (src/mission/server.ts dashboardDir()) at / and
# /index.html plus the shell assets, and the owner-only /mission-gateway proxy
# relays exactly those paths. Without this COPY every dashboard/asset request
# gets the mission server's {"error":{"code":"not_found"}} 404. Nothing reads
# this directory at build time, so the runtime stage is the only place it is
# needed (it resolves both the <cwd> and the dist/scripts/__dirname
# dashboardDir() candidates to /app/mission-dashboard).
COPY mission-dashboard ./mission-dashboard
RUN chmod +x scripts/entrypoint.sh && chown -R 1000:1000 /app && chmod -R 755 /app && chmod -R 777 /data
# Build stamp: the commit that produced this image. CI passes
# --build-arg GIT_SHA=<sha>; any runtime (Modal, Docker hosts) can then
# prove which code it is running instead of trusting a mutable :latest tag.
#
# Railway-native builds (a Railway service built directly from this
# Dockerfile via its GitHub integration, rather than from the CI-published
# GHCR image) never receive an explicit --build-arg GIT_SHA — Railway only
# auto-populates an ARG when its name matches one of Railway's own variables
# (docs.railway.com/guides/build-time-vs-runtime-secrets). Railway's git
# commit variable is named RAILWAY_GIT_COMMIT_SHA, so it is accepted here as
# a fallback build arg with the same name Railway already knows how to fill
# in automatically — no owner configuration required for this path.
ARG GIT_SHA=unknown
ARG RAILWAY_GIT_COMMIT_SHA=""
RUN sha="$GIT_SHA"; \
    if [ -z "$sha" ] || [ "$sha" = "unknown" ]; then sha="${RAILWAY_GIT_COMMIT_SHA:-unknown}"; fi; \
    echo "$sha" > /app/.image-version && chown 1000:1000 /app/.image-version
EXPOSE 3000 4000 8080
# Port-aware: mirrors scripts/start-prod.mjs (web honors PORT, api moves on collision)
# so the image reports healthy on hosts that inject their own public port (Blitz).
HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 \
  CMD node -e "let api=Number(process.env.AKBARAL_API_PORT||4000);let pub=Number(process.env.AKBARAL_WEB_PORT||process.env.PORT||3000);if(pub===api)api=api===4000?4001:api+1;fetch('http://127.0.0.1:'+pub+'/api/ready').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["sh", "scripts/entrypoint.sh"]
