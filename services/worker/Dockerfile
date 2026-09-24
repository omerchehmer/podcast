# Episode worker. Build from the repo root:
#   docker build -f services/worker/Dockerfile -t briefcast-worker .
FROM node:22-slim
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg ca-certificates && rm -rf /var/lib/apt/lists/*
RUN corepack enable
WORKDIR /app
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml tsconfig.base.json ./
COPY packages/shared packages/shared
COPY services/worker services/worker
RUN pnpm install --frozen-lockfile --filter @briefcast/worker...
WORKDIR /app/services/worker
# For now the image runs the CLI. Step 6 adds the queue consumer as the default command.
ENTRYPOINT ["pnpm", "exec", "tsx", "src/cli/episode.ts"]
