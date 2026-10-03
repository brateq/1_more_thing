# syntax=docker/dockerfile:1
FROM node:22-alpine AS frontend
WORKDIR /app
COPY package.json package-lock.json ./
RUN --mount=type=cache,target=/root/.npm npm ci
COPY index.html vite.config.ts tsconfig.json postcss.config.mjs ./
COPY app ./app
COPY lib ./lib
COPY public ./public
COPY scripts/compress.mjs ./scripts/compress.mjs
COPY scripts/build-service-worker.mjs scripts/service-worker.js ./scripts/
RUN npm run build:client

FROM rust:1.95-bookworm AS backend
WORKDIR /app
COPY Cargo.toml Cargo.lock ./
COPY src ./src
COPY drizzle ./drizzle
RUN --mount=type=cache,target=/usr/local/cargo/registry,sharing=locked \
    --mount=type=cache,target=/app/target,sharing=locked \
    cargo build --release --locked && cp target/release/and1 /usr/local/bin/and1

FROM debian:bookworm-slim AS runner
WORKDIR /app
ENV HOST=0.0.0.0 PORT=3000 DATABASE_PATH=/app/data/and1.db STATIC_DIR=/app/public
# Keep UID/GID 1000: the previous Node image owns the production volume.
RUN groupadd --gid 1000 app && useradd --uid 1000 --gid app --no-create-home app && \
    mkdir -p /app/data && chown app:app /app/data
COPY --from=backend /usr/local/bin/and1 /usr/local/bin/and1
COPY --from=frontend /app/dist/client ./public
USER app
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 CMD ["and1", "healthcheck"]
CMD ["and1"]
