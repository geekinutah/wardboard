# WardBoard container image: builds the web client, runs the server.
#
# Versions are checked by scripts/docker.test.mjs: the base image's
# major.minor must agree with `.node-version`, and the pnpm version must
# agree with the root `packageManager` field. Node 26 does not ship
# corepack, so pnpm is installed explicitly with npm.

ARG PNPM_VERSION=12.4.2

# --- Build: full workspace install + web client build ------------------------
FROM node:26.12-slim AS build
ARG PNPM_VERSION
# Playwright browsers are installed on the host (see scripts/setup.sh), never in the image.
ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1
RUN npm install -g pnpm@${PNPM_VERSION}
WORKDIR /app
COPY . .
RUN pnpm install --frozen-lockfile
RUN pnpm --filter web run build

# --- Runtime: production dependencies only -----------------------------------
FROM node:26.12-slim
ARG PNPM_VERSION
ENV NODE_ENV=production
RUN npm install -g pnpm@${PNPM_VERSION}
WORKDIR /app

# Every workspace manifest is copied so `pnpm install --prod --frozen-lockfile`
# sees the same importers as the committed lockfile and resolves it verbatim.
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml .npmrc ./
COPY apps/server/package.json ./apps/server/package.json
COPY apps/web/package.json ./apps/web/package.json
COPY packages/core/package.json ./packages/core/package.json
RUN pnpm install --prod --frozen-lockfile

# The server and core run as TypeScript directly under Node (type stripping),
# so only their sources are needed, plus the built web client from the build stage.
COPY --from=build /app/apps/web/dist ./apps/web/dist
COPY apps/server/src ./apps/server/src
COPY packages/core/src ./packages/core/src

# Non-root runtime user. /data is created (and owned) before the USER switch so
# a fresh named volume is seeded writable by the server: SQLite and photos live there.
RUN useradd --system wardboard \
    && mkdir -p /data \
    && chown wardboard /data
USER wardboard

# WARDBOARD_BASE_URL deliberately has no default: it is required at run time.
ENV WARDBOARD_HOST=0.0.0.0 \
    WARDBOARD_TRUST_IDENTITY_HEADERS_ON_NON_LOOPBACK=1 \
    WARDBOARD_PORT=8080 \
    WARDBOARD_DATA_DIR=/data \
    WARDBOARD_WEB_DIR=/app/apps/web/dist

VOLUME /data
EXPOSE 8080

# node:slim has no curl; Node's global fetch is the health probe.
HEALTHCHECK --interval=10s --timeout=5s --start-period=15s --retries=12 \
  CMD node -e "fetch('http://127.0.0.1:8080/api/health').then((r) => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"

CMD ["node", "apps/server/src/main.ts"]
