# Macro API + bundled Web_UI image. Build from the repository root:
#   docker build -t macro-api .
# Normally built by: docker compose -f deploy/macro/docker-compose.yml up -d --build

# ---- 1. production dependencies, exactly as pinned in bun.lock ----
FROM oven/bun:1.4-slim AS deps
WORKDIR /app
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile --production

# ---- 2. build the web front end into web/dist (the app, and the React + Vite landing site) ----
FROM oven/bun:1.4-slim AS web
WORKDIR /app
COPY package.json bun.lock tsconfig.json ./
# The build needs the dev dependencies (Vite, React); none of them reach the runtime image.
RUN bun install --frozen-lockfile
COPY scripts ./scripts
COPY web ./web
# The app lib imports pure modules from src/ (formatters, types), so the bundler needs it.
COPY src ./src
RUN bun scripts/build-web.ts

# ---- 3. runtime image ----
FROM oven/bun:1.4-slim
WORKDIR /app
ENV NODE_ENV=production

COPY package.json tsconfig.json ./
COPY --from=deps /app/node_modules ./node_modules
COPY src ./src
COPY --from=web /app/web/dist ./web/dist

# This image deliberately runs as root (no USER line). Macro_API controls sibling
# containers (Egress_Proxy and Sandboxes) through the Docker socket that Compose
# mounts at /var/run/docker.sock, and writes run data under DATA_DIR
# (/var/lib/macro, bind-mounted at the same path as on the host). Socket access
# is root-equivalent on the VM whichever user runs here, so a non-root user would
# only add group-id juggling. The secrets live only in this container's
# environment (env_file); they are never passed to a Sandbox or the Egress_Proxy.
EXPOSE 3000
CMD ["bun","src/main.ts"]
