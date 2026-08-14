FROM node:22-bookworm-slim

WORKDIR /app

RUN corepack enable && corepack prepare pnpm@10.33.2 --activate

COPY spikes/deepseek-harness/package.json spikes/deepseek-harness/pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile --ignore-scripts

COPY spikes/deepseek-harness/profile.patch.yml ./profile.patch.yml
COPY spikes/deepseek-harness/fixtures ./fixtures
COPY spikes/deepseek-harness/src ./src

CMD ["pnpm", "probe"]
