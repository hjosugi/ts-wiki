FROM docker.io/oven/bun:1.3 AS deps

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
RUN bun --filter '@ts-wiki/server' typecheck

FROM docker.io/oven/bun:1.3-slim AS runtime

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

EXPOSE 4000
VOLUME ["/data"]

CMD ["bun", "apps/server/src/index.ts"]
