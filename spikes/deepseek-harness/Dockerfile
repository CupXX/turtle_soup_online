FROM node:22-bookworm-slim

WORKDIR /app

RUN corepack enable && corepack prepare pnpm@10.33.2 --activate

RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ \
  && rm -rf /var/lib/apt/lists/*

COPY spikes/deepseek-harness/package.json spikes/deepseek-harness/pnpm-lock.yaml ./
COPY spikes/deepseek-harness/pnpm-workspace.yaml ./pnpm-workspace.yaml
RUN pnpm install --frozen-lockfile

COPY spikes/deepseek-harness/profile.patch.yml ./profile.patch.yml
COPY spikes/deepseek-harness/fixtures ./fixtures
COPY spikes/deepseek-harness/src ./src

CMD ["pnpm", "probe"]
