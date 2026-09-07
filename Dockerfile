FROM node:22-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json ./
COPY src ./src
COPY db ./db
RUN npm run build

FROM node:22-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production
ENV AKBARAL_UPLOAD_DIR=/data/uploads
ENV DATABASE_URL=file:/data/akbaral.db
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates && rm -rf /var/lib/apt/lists/*
RUN mkdir -p /data/uploads
VOLUME ["/data"]
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY package.json ./
COPY src ./src
COPY db ./db
COPY public ./public
COPY scripts ./scripts
RUN chmod +x scripts/entrypoint.sh
EXPOSE 3000
CMD ["sh", "scripts/entrypoint.sh"]
