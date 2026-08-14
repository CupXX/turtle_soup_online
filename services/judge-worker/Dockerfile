FROM node:22-bookworm-slim

WORKDIR /app

RUN corepack enable && corepack prepare pnpm@10.33.2 --activate
ENV NODE_ENV=development

RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ \
  && rm -rf /var/lib/apt/lists/*

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY tsconfig.base.json tsconfig.base.json
COPY packages/contracts/package.json packages/contracts/package.json
COPY services/judge-worker/package.json services/judge-worker/package.json
RUN pnpm install --frozen-lockfile --prod=false --filter @turtle-soup/judge-worker...

COPY packages/contracts packages/contracts
COPY services/judge-worker services/judge-worker
COPY spikes/deepseek-harness/profile.patch.yml spikes/deepseek-harness/profile.patch.yml

RUN pnpm --filter @turtle-soup/judge-worker build

RUN groupadd --system --gid 10001 turtle-soup \
  && useradd --system --uid 10001 --gid 10001 --create-home --home-dir /home/turtle-soup turtle-soup \
  && chown turtle-soup:turtle-soup /home/turtle-soup

USER turtle-soup
ENV NODE_ENV=production

CMD ["node", "services/judge-worker/dist/main.js"]
