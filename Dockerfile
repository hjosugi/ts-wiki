# Build and typecheck once on the native GitHub runner. The resulting source and
# web assets are architecture-independent; only the final runtime dependency
# install needs to run for each target platform.
FROM --platform=$BUILDPLATFORM docker.io/oven/bun:1.3.14 AS deps

WORKDIR /app

RUN apt-get update \
  && apt-get install -y --no-install-recommends nodejs \
  && rm -rf /var/lib/apt/lists/*

COPY package.json bun.lock bunfig.toml tsconfig.base.json ./
COPY packages/core/package.json packages/core/package.json
COPY apps/server/package.json apps/server/package.json
COPY apps/web/package.json apps/web/package.json

RUN bun install --frozen-lockfile

FROM deps AS build

COPY . .

RUN cd apps/web && node ../../node_modules/vite/bin/vite.js build
RUN bun --filter '@kawaii-wiki/server' typecheck

FROM docker.io/oven/bun:1.3.14-slim AS runtime

WORKDIR /app

ENV NODE_ENV=production
ENV PORT=4000
ENV DATA_DIR=/data
ENV DATABASE_PATH=/data/ts-wiki.sqlite
ENV WEB_DIST_DIR=/app/apps/web/dist

COPY package.json bun.lock bunfig.toml tsconfig.base.json ./
COPY packages/core/package.json packages/core/package.json
COPY apps/server/package.json apps/server/package.json
COPY apps/web/package.json apps/web/package.json
RUN bun install --frozen-lockfile --production

COPY --from=build /app/packages/core ./packages/core
COPY --from=build /app/apps/server ./apps/server
COPY --from=build /app/apps/web/dist ./apps/web/dist
COPY --from=build /app/apps/web/README.md ./apps/web/README.md
COPY --from=build /app/docs ./docs
COPY --from=build /app/CHANGELOG.md /app/CODE_OF_CONDUCT.md /app/CONTRIBUTING.md /app/README.md /app/SECURITY.md ./
COPY --chmod=755 scripts/docker-entrypoint.sh /usr/local/bin/kawaii-wiki-entrypoint

RUN mkdir -p /data && chown -R bun:bun /data /app

EXPOSE 4000
VOLUME ["/data"]

USER bun

ENTRYPOINT ["kawaii-wiki-entrypoint"]

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD ["bun", "-e", "const r=await fetch('http://127.0.0.1:4000/api/health');if(!r.ok)process.exit(1)"]

CMD ["bun", "apps/server/src/index.ts"]
