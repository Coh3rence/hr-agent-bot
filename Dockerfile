# Railway deploy image for the grammy long-polling bot (Bun runtime).
# Bun executes the TypeScript entrypoint directly — there is no build/transpile
# step. This is a worker (long-polling), so it exposes no inbound port.
FROM oven/bun:1

WORKDIR /app

# Install against the committed lockfile for reproducible builds. Copy only the
# manifest + lockfile first so this layer is cached unless dependencies change.
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile

# Application source.
COPY . .

# NODE_ENV and all secrets are injected by Railway env vars, never baked in.
CMD ["bun", "run", "index.ts"]
