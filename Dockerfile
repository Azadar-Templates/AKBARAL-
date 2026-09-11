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
RUN npm run build

FROM node:22-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production
ENV AKBARAL_UPLOAD_DIR=/data/uploads
ENV DATABASE_URL=file:/data/akbaral.db
ENV HOST=0.0.0.0
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates postgresql-client && rm -rf /var/lib/apt/lists/*
RUN mkdir -p /data/uploads /data/backups
VOLUME ["/data"]
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/.next ./.next
COPY package.json next.config.mjs ./
COPY db ./db
COPY public ./public
COPY scripts ./scripts
RUN chmod +x scripts/entrypoint.sh
EXPOSE 3000 4000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/api/ready').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["sh", "scripts/entrypoint.sh"]
