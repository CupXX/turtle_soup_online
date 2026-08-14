# Multiplayer AI-Native Turtle Soup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the approved single-game multiplayer Turtle Soup MVP with deterministic server-authoritative rules, Supabase persistence/Realtime, and a Dockerized DeepSeek Harness semantic judge.

**Architecture:** A Next.js App Router application owns every HTTP mutation and reads a public Supabase projection. A durable Postgres queue serializes normal messages and final answers, while a separately deployed Judge Worker leases one queue head, calls three strict structured-output Harness skills, and commits results atomically. Hidden solution, key-point, final-answer, queue, and model-attempt data remain in an unexposed `private` schema.

**Tech Stack:** Node.js 22 for the web/TypeScript workspace, pnpm 10.33.2, Next.js 16.3.1, React 19.2.8, TypeScript 7.0.2, Supabase CLI 2.114.0, `@supabase/supabase-js` 2.112.3, Postgres.js 3.4.9, Zod 4.4.3, Ajv 8.20.0, Vitest 4.1.10, Playwright 1.62.1, and the Harness/runtime version accepted by Task 1.

## Global Constraints

- Source of truth: `docs/superpowers/specs/2026-08-14-multiplayer-turtle-soup-design.md`.
- The website has one current game and no rooms.
- The 10-active-player value is a verification target, never an admission limit.
- The browser has read-only access to named `api` tables and no access to `private`.
- Every state-changing browser request goes through a same-origin Next.js Route Handler.
- The LLM returns strict structured data and no player-facing free text.
- The LLM never owns ordering, score, first-hit claims, success, state transitions, or authorization.
- Question judging excludes conversation history and discovered-key-point state.
- Final-answer success is computed by deterministic server code from covered IDs.
- Normal messages and final answers share one per-game server-receipt sequence.
- Do not use `SKIP LOCKED` to overtake a leased/blocked queue head.
- Do not store Harness reasoning, raw sensitive prompts, or raw model responses.
- Rate-limit values are server-side configurable abuse-protection defaults, not gameplay rules.
- Do not implement any out-of-scope feature from design §2.2.
- Use TDD for each task and stage only the files named by that task before committing.

---

## Planned File Map

```text
.
├─ package.json
├─ pnpm-lock.yaml
├─ pnpm-workspace.yaml
├─ tsconfig.base.json
├─ eslint.config.mjs
├─ .node-version
├─ .gitignore
├─ .env.example
├─ apps/web/
│  ├─ package.json
│  ├─ next.config.ts
│  ├─ tsconfig.json
│  ├─ src/app/
│  │  ├─ layout.tsx
│  │  ├─ page.tsx
│  │  ├─ globals.css
│  │  ├─ error.tsx
│  │  ├─ admin/page.tsx
│  │  └─ api/
│  ├─ src/components/game/
│  ├─ src/components/admin/
│  ├─ src/hooks/use-game-realtime.ts
│  ├─ src/server/auth/
│  ├─ src/server/db/
│  ├─ src/server/game/
│  ├─ src/server/http/
│  └─ src/server/security/
├─ packages/contracts/
│  ├─ schemas/
│  └─ src/
├─ packages/game-core/
│  └─ src/
├─ services/judge-worker/
│  ├─ Dockerfile
│  ├─ src/db/
│  ├─ src/runtime/
│  └─ src/skills/
├─ spikes/deepseek-harness/
├─ supabase/
│  ├─ config.toml
│  ├─ migrations/
│  ├─ seed.sql
│  └─ tests/database/
├─ e2e/
└─ docs/operations/
```

## Task 1: DeepSeek Harness Feasibility Gate

**Files:**
- Create: `spikes/deepseek-harness/package.json`
- Create: `spikes/deepseek-harness/README.md`
- Create: `spikes/deepseek-harness/Dockerfile`
- Create: `spikes/deepseek-harness/src/probe.ts`
- Create: `spikes/deepseek-harness/src/probe.test.ts`
- Create: `spikes/deepseek-harness/fixtures/extraction-input.json`
- Create: `spikes/deepseek-harness/fixtures/question-input.json`
- Create: `spikes/deepseek-harness/fixtures/final-answer-input.json`
- Create: `docs/decisions/0001-judge-worker-runtime.md`

**Interfaces:**
- Consumes: `@deepseek-ai/dsh@0.1.0-rc.6` as the currently published candidate.
- Produces: a go/no-go decision containing the exact Harness package/commit, supported runtime/language, minimal no-tool invocation, sensitive-session persistence result, Docker command, and structured-output evidence.

- [ ] **Step 1: Record the candidate package evidence**

Create the spike package with these exact development dependencies:

```json
{
  "name": "@turtle-soup/deepseek-harness-spike",
  "private": true,
  "type": "module",
  "scripts": {
    "test": "vitest run",
    "probe": "tsx src/probe.ts"
  },
  "dependencies": {
    "@deepseek-ai/dsh": "0.1.0-rc.6",
    "ajv": "8.20.0"
  },
  "devDependencies": {
    "tsx": "4.23.12",
    "typescript": "7.0.2",
    "vitest": "4.1.10"
  }
}
```

Run:

```powershell
pnpm --dir spikes/deepseek-harness install
npm view '@deepseek-ai/dsh@0.1.0-rc.6' name version bin dependencies --json
npm pack '@deepseek-ai/dsh@0.1.0-rc.6' --dry-run
```

Expected: both commands succeed and identify the exact RC package. Save the command output summary in `spikes/deepseek-harness/README.md`; do not copy API keys or machine paths.

- [ ] **Step 2: Write failing probe tests**

Create tests that require these exported probe results:

```ts
type ProbeResult = {
  runtime: string;
  harnessVersion: string;
  toolsExposed: string[];
  persistenceFiles: string[];
  output: unknown;
};

expect(result.toolsExposed).toEqual([]);
expect(result.persistenceFiles).toEqual([]);
expect(questionResult.output).toEqual({
  verdict: 'YES',
  fully_covered_key_point_ids: ['00000000-0000-4000-8000-000000000001'],
});
```

- [ ] **Step 3: Run the probe tests and verify failure**

Run:

```powershell
pnpm --dir spikes/deepseek-harness test
```

Expected: FAIL because `src/probe.ts` does not yet provide an isolated Harness invocation.

- [ ] **Step 4: Implement the smallest supported Harness probe**

The probe must create a fresh context for each fixture, register no model-facing tools, allow only the model adapter's outbound provider request, validate the final JSON, terminate after one request, and scan its configured Harness home for persisted prompt/session content. Do not use the stock coding-persona headless bundle as proof of the production profile.

The executable signature is:

```ts
export async function runProbe(
  fixturePath: string,
  schemaPath: string,
  runtimeHome: string,
): Promise<ProbeResult>;
```

- [ ] **Step 5: Build and run the probe in Docker**

Run:

```powershell
docker build -f spikes/deepseek-harness/Dockerfile -t turtle-soup-harness-spike .
docker run --rm --env-file .env.local turtle-soup-harness-spike
```

Expected: one valid structured result for each fixture, zero exposed tools, and no persisted sensitive input. The image must not mount the workspace or Docker socket.

- [ ] **Step 6: Write the runtime decision**

`docs/decisions/0001-judge-worker-runtime.md` must state one of these concrete outcomes:

```text
GO: exact Harness version/commit, chosen runtime, exact Docker command, exact minimal profile/plugin path, and passed evidence.
NO-GO: failed acceptance item, reproducible command, error, and why continuing would violate the design.
```

If NO-GO, stop the entire plan and ask the user whether to change the Harness requirement. Do not continue to Task 2.

- [ ] **Step 7: Verify and commit the spike**

Run:

```powershell
pnpm --dir spikes/deepseek-harness test
git diff --check
git add -- spikes/deepseek-harness docs/decisions/0001-judge-worker-runtime.md
git diff --cached --name-only
git commit -m "spike: verify deepseek harness runtime"
```

Expected: tests pass, only spike/decision files are staged, and the decision is GO before Task 2.

## Task 2: Bootstrap the Web Workspace and Shared Contracts

**Files:**
- Create: `package.json`
- Create: `pnpm-workspace.yaml`
- Create: `tsconfig.base.json`
- Create: `eslint.config.mjs`
- Create: `.node-version`
- Create: `.gitignore`
- Create: `.env.example`
- Create: `packages/contracts/package.json`
- Create: `packages/contracts/tsconfig.json`
- Create: `packages/contracts/schemas/key-point-extraction-result.schema.json`
- Create: `packages/contracts/schemas/question-judge-result.schema.json`
- Create: `packages/contracts/schemas/final-answer-judge-result.schema.json`
- Create: `packages/contracts/src/game.ts`
- Create: `packages/contracts/src/judge.ts`
- Create: `packages/contracts/src/api.ts`
- Create: `packages/contracts/src/index.ts`
- Test: `packages/contracts/src/contracts.test.ts`

**Interfaces:**
- Produces: `GameStatus`, `MessageStatus`, `JudgeVerdict`, `PublicGameSnapshot`, three Judge input/result types, and canonical JSON Schemas consumable by any Worker runtime.

- [ ] **Step 1: Create root workspace configuration**

Use exact root package metadata:

```json
{
  "name": "multiplayer-turtle-soup",
  "private": true,
  "packageManager": "pnpm@10.33.2",
  "engines": { "node": "22.x" },
  "scripts": {
    "build": "pnpm -r build",
    "lint": "pnpm -r lint",
    "test": "pnpm -r test",
    "typecheck": "pnpm -r typecheck"
  },
  "devDependencies": {
    "@types/node": "22.20.1",
    "eslint": "10.8.1",
    "supabase": "2.114.0",
    "tsx": "4.23.12",
    "typescript": "7.0.2",
    "vitest": "4.1.10"
  }
}
```

Set `.node-version` to `22`. Workspace globs are `apps/*`, `packages/*`, and `services/*`.

`.env.example` lists names only, with no usable secret values:

```dotenv
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=
GAME_WEB_DATABASE_URL=
JUDGE_WORKER_DATABASE_URL=
SITE_ORIGIN=http://localhost:3000
PLAYER_SESSION_SECRET=
ADMIN_SESSION_SECRET=
ADMIN_SECRET=
IDEMPOTENCY_HMAC_SECRET=
IP_HASH_SECRET=
JUDGE_PROVIDER=
JUDGE_MODEL=
JUDGE_API_BASE_URL=
JUDGE_API_KEY=
JUDGE_TIMEOUT_MS=30000
WORKER_ID=local-worker
BUILD_VERSION=development
RATE_LIMIT_PLAYER_JOIN_PER_MINUTE=10
RATE_LIMIT_MESSAGE_PER_PLAYER_PER_MINUTE=12
RATE_LIMIT_MESSAGE_PER_IP_PER_MINUTE=30
RATE_LIMIT_FINAL_ANSWER_PER_PLAYER_PER_5_MINUTES=3
RATE_LIMIT_ADMIN_LOGIN_PER_IP_PER_15_MINUTES=5
RATE_LIMIT_ADMIN_WRITE_PER_SESSION_PER_MINUTE=10
```

- [ ] **Step 2: Write failing contract tests**

Test all three result schemas with Ajv:

```ts
expect(validateQuestion({ verdict: 'YES', fully_covered_key_point_ids: [] })).toBe(true);
expect(validateQuestion({ verdict: 'MAYBE', fully_covered_key_point_ids: [] })).toBe(false);
expect(validateFinal({ covered_key_point_ids: [], explanation: 'hidden' })).toBe(false);
expect(validateExtraction({ key_points: [{ content: 'a' }, { content: 'b' }] })).toBe(false);
```

- [ ] **Step 3: Run the tests and verify failure**

Run:

```powershell
corepack enable
pnpm install
pnpm --filter @turtle-soup/contracts test
```

Expected: FAIL because schemas and exported contracts are missing.

- [ ] **Step 4: Implement canonical schemas and TypeScript types**

`packages/contracts/package.json` uses exact scripts and Ajv dependency:

```json
{
  "name": "@turtle-soup/contracts",
  "private": true,
  "type": "module",
  "scripts": {
    "build": "tsc -p tsconfig.json",
    "lint": "eslint src",
    "test": "vitest run",
    "typecheck": "tsc -p tsconfig.json --noEmit"
  },
  "dependencies": { "ajv": "8.20.0" },
  "devDependencies": { "typescript": "7.0.2", "vitest": "4.1.10" }
}
```

Use `additionalProperties: false`, 3-5 extraction items, verdict enum
`YES|NO|BOTH|IRRELEVANT`, UUID ID formats, and unique ID arrays. Export:

```ts
export type JudgeVerdict = 'YES' | 'NO' | 'BOTH' | 'IRRELEVANT';
export type QuestionJudgeResult = {
  verdict: JudgeVerdict;
  fully_covered_key_point_ids: string[];
};
export type FinalAnswerJudgeResult = { covered_key_point_ids: string[] };
export type JudgeErrorCode =
  | 'TRANSPORT_ERROR'
  | 'TIMEOUT'
  | 'EMPTY_RESPONSE'
  | 'INVALID_JSON'
  | 'SCHEMA_INVALID'
  | 'UNKNOWN_KEY_POINT_ID'
  | 'LEASE_LOST';
export type ApiErrorCode =
  | 'VALIDATION_ERROR'
  | 'PLAYER_SESSION_REQUIRED'
  | 'ADMIN_SESSION_REQUIRED'
  | 'NO_CURRENT_GAME'
  | 'GAME_NOT_ACTIVE'
  | 'GAME_ALREADY_ACTIVE'
  | 'JUDGE_UNAVAILABLE'
  | 'QUEUE_BLOCKED'
  | 'RATE_LIMITED'
  | 'IDEMPOTENCY_CONFLICT'
  | 'INTERNAL_ERROR';
```

`PublicGameSnapshot` contains public game, messages, events, players, stats, and nullable reveal only. It contains no solution/key-point data while ACTIVE and no final-answer body in any state.

- [ ] **Step 5: Verify and commit contracts**

Run:

```powershell
pnpm --filter @turtle-soup/contracts test
pnpm --filter @turtle-soup/contracts typecheck
git diff --check
git add -- package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json eslint.config.mjs .node-version .gitignore .env.example packages/contracts
git diff --cached --name-only
git commit -m "chore: bootstrap shared contracts"
```

## Task 3: Implement Pure Deterministic Game Rules

**Files:**
- Create: `packages/game-core/package.json`
- Create: `packages/game-core/tsconfig.json`
- Create: `packages/game-core/src/verdict.ts`
- Create: `packages/game-core/src/scoring.ts`
- Create: `packages/game-core/src/final-answer.ts`
- Create: `packages/game-core/src/lifecycle.ts`
- Create: `packages/game-core/src/index.ts`
- Test: `packages/game-core/src/verdict.test.ts`
- Test: `packages/game-core/src/scoring.test.ts`
- Test: `packages/game-core/src/final-answer.test.ts`
- Test: `packages/game-core/src/lifecycle.test.ts`

**Interfaces:**
- Consumes: `JudgeVerdict` and `GameStatus` from contracts.
- Produces:

```ts
reactionForVerdict(verdict: JudgeVerdict): '✅' | '❌' | '❓' | '👎';
calculateHitRate(yesCount: number, questionCount: number): number | null;
newClaimScore(newClaimIds: readonly string[]): number;
isFinalAnswerSuccessful(allIds: readonly string[], coveredIds: readonly string[]): boolean;
canAcceptGameplayAction(status: GameStatus): boolean;
```

- [ ] **Step 1: Write failing rule tests**

Cover verdict mapping, YES-only numerator, zero-question null hit rate, de-duplicated final coverage, 3/4 failure, 4/4 success, +1 per new claim, no final-answer +1, ACTIVE-only acceptance, and force-end zero final reward.

- [ ] **Step 2: Verify tests fail**

Run:

```powershell
pnpm --filter @turtle-soup/game-core test
```

Expected: FAIL because the rule functions do not exist.

- [ ] **Step 3: Implement minimal pure functions**

Final success must be set equality after validating covered IDs against the fixed set:

```ts
export function isFinalAnswerSuccessful(allIds: readonly string[], coveredIds: readonly string[]) {
  const all = new Set(allIds);
  const covered = new Set(coveredIds);
  return covered.size === all.size && [...all].every((id) => covered.has(id));
}
```

Do not import database, Next.js, Supabase, or Harness code.

- [ ] **Step 4: Verify and commit game core**

Run:

```powershell
pnpm --filter @turtle-soup/game-core test
pnpm --filter @turtle-soup/game-core typecheck
git add -- packages/game-core
git diff --cached --name-only
git commit -m "feat: add deterministic game rules"
```

## Task 4: Create the Supabase Schema, Constraints, and Indexes

**Files:**
- Create via CLI: `supabase/config.toml`
- Create via CLI: the migration ending `_initial_game_schema.sql`
- Create: `supabase/seed.sql`
- Test: `supabase/tests/database/001_schema.test.sql`

**Interfaces:**
- Produces: all `api` and `private` tables/enums from design §7, the single-open-game constraint, immutable key points after activation, unique claims, action idempotency, and required indexes.

- [ ] **Step 1: Initialize Supabase and create the migration through the CLI**

Run:

```powershell
pnpm exec supabase init
pnpm exec supabase migration new initial_game_schema
```

Use the exact migration path printed by the second command for the remaining steps; do not rename or invent a timestamp.

- [ ] **Step 2: Write failing pgTAP schema tests**

Assert schemas/tables, enum values, unique keys, partial single-open-game index, foreign-key indexes, and reveal separation. Include:

```sql
select has_schema('api');
select has_schema('private');
select has_table('api', 'games');
select has_table('private', 'game_secrets');
select has_pk('private', 'key_point_claims');
select has_index('api', 'messages', array['game_id', 'sequence_no']);
```

- [ ] **Step 3: Start local Supabase and verify tests fail**

Run:

```powershell
pnpm exec supabase start
pnpm exec supabase test db
```

Expected: FAIL because the migration is empty.

- [ ] **Step 4: Implement enums and tables exactly from design §7**

The migration must create:

```sql
create schema if not exists api;
create schema if not exists private;

create type api.game_status as enum ('WAITING', 'ACTIVE', 'ENDED');
create type api.game_end_reason as enum ('FINAL_ANSWER_SUCCESS', 'FORCE_ENDED');
create type api.public_game_event_type as enum
  ('FINAL_ANSWER_FAILED', 'FINAL_ANSWER_SUCCEEDED', 'FORCE_ENDED');
create type api.message_status as enum ('PENDING', 'JUDGED', 'ERROR', 'CANCELLED');
create type api.judge_verdict as enum ('YES', 'NO', 'BOTH', 'IRRELEVANT');
create type private.action_type as enum ('NORMAL_MESSAGE', 'FINAL_ANSWER');
create type private.action_status as enum ('PENDING', 'PROCESSING', 'RETRY', 'BLOCKED', 'COMPLETED', 'CANCELLED');
create type private.job_status as enum ('PENDING', 'PROCESSING', 'RETRY', 'BLOCKED', 'COMPLETED', 'CANCELLED');
```

Create every public/private table listed in design §7. Use UUID primary keys, `timestamptz`, explicit CHECK constraints, and named foreign keys. Add the one-open-game guard:

```sql
create unique index games_single_open_idx
on api.games ((true))
where status in ('WAITING', 'ACTIVE');
```

Add the queue-head partial index for `PENDING`, `RETRY`, and `BLOCKED`; index every uncovered foreign key.

- [ ] **Step 5: Add immutable-key-point and timestamp triggers**

The key-point guard must reject UPDATE/DELETE after the associated game is ACTIVE or ENDED. Timestamp triggers update only `updated_at` columns and do not mutate business fields.

- [ ] **Step 6: Reset, test, and commit schema**

Run:

```powershell
pnpm exec supabase db reset
pnpm exec supabase test db
pnpm exec supabase migration list --local
git add -- supabase/config.toml supabase/migrations supabase/seed.sql supabase/tests/database/001_schema.test.sql
git diff --cached --name-only
git commit -m "feat: add game database schema"
```

## Task 5: Lock Down Grants, RLS, and Realtime Publication

**Files:**
- Create via CLI: the migration ending `_security_and_realtime.sql`
- Test: `supabase/tests/database/002_security.test.sql`
- Create: `docs/operations/database-roles.md`

**Interfaces:**
- Produces: `anon` read-only access to named `api` tables, zero client access to `private`, named `game_web`/`judge_worker` roles, and a public-only Realtime publication.

- [ ] **Step 1: Create the migration through the CLI**

Run:

```powershell
pnpm exec supabase migration new security_and_realtime
```

- [ ] **Step 2: Write failing security tests**

Use `set local role anon` and verify SELECT succeeds only for public tables while INSERT and private SELECT fail. Query `pg_publication_tables` and assert no private schema rows.

- [ ] **Step 3: Verify the tests fail before security SQL**

Run `pnpm exec supabase db reset; pnpm exec supabase test db` and expect the new security test to fail.

- [ ] **Step 4: Implement least-privilege roles and RLS**

The migration must:

```sql
revoke all on schema api from public;
revoke all on schema private from public, anon, authenticated;
grant usage on schema api to anon;
grant select on api.players, api.games, api.messages, api.game_events,
  api.game_player_stats, api.game_reveals, api.revealed_key_points to anon;
```

Enable RLS on every `api` table, create explicit `FOR SELECT TO anon USING (true)` policies, and grant no client mutation privileges. Create runtime roles without embedding production passwords and grant only the table/sequence privileges required by their responsibilities. Add only public tables to `supabase_realtime`.

Because `game_web` and `judge_worker` are direct non-BYPASSRLS roles, add
explicit operation-specific RLS policies for those roles on the public tables
they must read or mutate. Write policies with both `USING` and `WITH CHECK` for
UPDATE; do not solve a policy failure by granting BYPASSRLS or making the role a
table owner.

- [ ] **Step 5: Document runtime role provisioning**

`docs/operations/database-roles.md` must instruct the operator to generate independent random passwords, set LOGIN passwords through the Supabase SQL editor/secure administration channel, store connection strings as `GAME_WEB_DATABASE_URL` and `JUDGE_WORKER_DATABASE_URL`, and never commit those values.

- [ ] **Step 6: Verify advisors and commit security**

Run:

```powershell
pnpm exec supabase db reset
pnpm exec supabase test db
pnpm exec supabase db advisors
git add -- supabase/migrations supabase/tests/database/002_security.test.sql docs/operations/database-roles.md
git diff --cached --name-only
git commit -m "feat: secure database access boundaries"
```

Expected: database tests pass; security advisor findings are fixed or documented with a specific accepted reason.

## Task 6: Bootstrap Next.js and Server Infrastructure

**Files:**
- Create: `apps/web/package.json`
- Create: `apps/web/next.config.ts`
- Create: `apps/web/tsconfig.json`
- Create: `apps/web/src/app/layout.tsx`
- Create: `apps/web/src/app/page.tsx`
- Create: `apps/web/src/app/globals.css`
- Create: `apps/web/src/app/error.tsx`
- Create: `apps/web/src/server/env.ts`
- Create: `apps/web/src/server/db/client.ts`
- Create: `apps/web/src/server/http/responses.ts`
- Test: `apps/web/src/server/env.test.ts`
- Test: `apps/web/src/server/http/responses.test.ts`

**Interfaces:**
- Produces:

```ts
getServerEnv(): ServerEnv;
withWebTransaction<T>(fn: (sql: TransactionSql) => Promise<T>): Promise<T>;
ok<T>(data: T, init?: ResponseInit): Response;
apiError(code: ApiErrorCode, status: number, retryable?: boolean): Response;
```

- [ ] **Step 1: Write failing environment and response tests**

Require server-only validation for Supabase URL/publishable key, DB URL, cookie secrets, HMAC secrets, site origin, and configurable rate limits. Assert errors return only `{error:{code,message,retryable}}` and never include thrown SQL text.

- [ ] **Step 2: Verify tests fail**

Run `pnpm --filter @turtle-soup/web test` and expect missing modules.

- [ ] **Step 3: Create the minimal Next.js App Router application**

Pin `next@16.3.1`, `react@19.2.8`, `react-dom@19.2.8`,
`@supabase/supabase-js@2.112.3`, `postgres@3.4.9`, and `zod@4.4.3`.
Pin development dependencies `eslint-config-next@16.3.1`,
`@types/react@19.2.18`, `@types/react-dom@19.2.4`,
`@testing-library/react@16.3.2`, `@testing-library/user-event@14.6.4`, and
`jsdom@30.0.1`. Use the Node runtime; do not add Edge runtime exports.

- [ ] **Step 4: Implement the DB client correctly for Vercel**

Use Postgres.js with the transaction-pooler URL, `prepare: false`, a small connection maximum, and no import from Client Components. `withWebTransaction` must open a short transaction and never wrap external HTTP/model calls.

- [ ] **Step 5: Verify web foundation and commit**

Run:

```powershell
pnpm --filter @turtle-soup/web test
pnpm --filter @turtle-soup/web typecheck
pnpm --filter @turtle-soup/web build
git add -- apps/web package.json pnpm-lock.yaml
git diff --cached --name-only
git commit -m "chore: bootstrap nextjs server foundation"
```

## Task 7: Add Signed Sessions, Input Validation, Idempotency, and Rate Limits

**Files:**
- Create: `apps/web/src/server/auth/session-token.ts`
- Create: `apps/web/src/server/auth/player-session.ts`
- Create: `apps/web/src/server/auth/admin-session.ts`
- Create: `apps/web/src/server/security/input.ts`
- Create: `apps/web/src/server/security/origin.ts`
- Create: `apps/web/src/server/security/idempotency.ts`
- Create: `apps/web/src/server/security/rate-limit.ts`
- Create: `apps/web/src/app/api/player-session/route.ts`
- Create: `apps/web/src/app/api/admin/session/route.ts`
- Test: `apps/web/src/server/auth/session-token.test.ts`
- Test: `apps/web/src/server/auth/player-session.test.ts`
- Test: `apps/web/src/server/auth/admin-session.test.ts`
- Test: `apps/web/src/server/security/input.test.ts`
- Test: `apps/web/src/server/security/origin.test.ts`
- Test: `apps/web/src/server/security/idempotency.test.ts`
- Test: `apps/web/src/server/security/rate-limit.test.ts`
- Test: `apps/web/src/app/api/player-session/route.test.ts`
- Test: `apps/web/src/app/api/admin/session/route.test.ts`

**Interfaces:**
- Produces:

```ts
signSession(payload: SessionPayload, secret: string, ttlSeconds: number): string;
verifySession(token: string, secret: string): SessionPayload | null;
normalizeNickname(value: unknown): { display: string; key: string };
assertSameOrigin(request: Request): void;
claimIdempotency(input: IdempotencyInput): Promise<IdempotencyClaim>;
consumeRateLimit(input: RateLimitInput): Promise<RateLimitResult>;
```

Local types are:

```ts
type SessionPayload = {
  subject: string;
  kind: 'player' | 'admin';
  issuedAt: number;
  expiresAt: number;
};
type IdempotencyInput = {
  actorScope: string;
  operation: string;
  key: string;
  payload: unknown;
};
type IdempotencyClaim =
  | { kind: 'NEW' }
  | { kind: 'REPLAY'; resultResourceId: string; responseStatus: number };
type RateLimitInput = { bucket: string; limit: number; windowSeconds: number };
type RateLimitResult =
  | { allowed: true; remaining: number }
  | { allowed: false; retryAfterSeconds: number };
```

- [ ] **Step 1: Write failing security tests**

Cover signature tampering, expiry, 365-day player TTL, eight-hour admin TTL, NFKC/case-insensitive nickname key, control-character rejection, constant-time secret comparison, origin mismatch, HMAC payload digest, same-key/same-body replay, same-key/different-body conflict, raw-IP absence, and Retry-After calculation.

- [ ] **Step 2: Run tests and verify failure**

Run `pnpm --filter @turtle-soup/web test -- session input origin idempotency rate-limit`.

- [ ] **Step 3: Implement server-only security modules**

Use Node `crypto.createHmac` and `timingSafeEqual`. Do not introduce Supabase Auth. Cookie options are production Secure, HttpOnly, player SameSite=Lax, and admin SameSite=Strict. Rate limits read validated server defaults and store HMAC IP keys.

Every state-changing handler reads the exact HTTP header name
`Idempotency-Key`; missing or non-UUID values return `VALIDATION_ERROR`.

- [ ] **Step 4: Implement player/admin session routes**

Player POST finds/creates normalized identity transactionally and sets the player cookie. Admin POST applies the login IP limit, compares `ADMIN_SECRET`, logs a safe audit row, and sets the admin cookie. Admin DELETE clears it.

- [ ] **Step 5: Verify and commit security foundation**

Run test, typecheck, lint, and build for `@turtle-soup/web`; then stage only Task 7 files and commit:

```powershell
git commit -m "feat: add secure player and admin sessions"
```

## Task 8: Implement Current-Game Snapshot and Join APIs

**Files:**
- Create: `apps/web/src/server/game/get-current-snapshot.ts`
- Create: `apps/web/src/server/game/join-current-game.ts`
- Create: `apps/web/src/app/api/game/current/route.ts`
- Create: `apps/web/src/app/api/game/current/join/route.ts`
- Test: `apps/web/src/server/game/get-current-snapshot.test.ts`
- Test: `apps/web/src/server/game/join-current-game.test.ts`
- Test: `apps/web/src/app/api/game/current/route.test.ts`

**Interfaces:**
- Produces:

```ts
getCurrentSnapshot(sql: Sql, playerId?: string): Promise<PublicGameSnapshot | null>;
joinCurrentGame(sql: TransactionSql, playerId: string): Promise<{ gameId: string } | null>;
```

- [ ] **Step 1: Write failing snapshot privacy tests**

Assert newest WAITING/ACTIVE selection, newest ENDED fallback, WAITING surface null, ACTIVE reveal null, ENDED reveal present, message/event sequence ordering, zero final-answer bodies, and current-player stats creation without score/question mutation.

- [ ] **Step 2: Verify tests fail**

Run the web test filter for `current-snapshot` and `join-current-game`.

- [ ] **Step 3: Implement snapshot queries and idempotent join**

Fetch independent collections in parallel where possible. Merge no private data into the DTO. Join uses `insert ... on conflict do nothing` for `(game_id, player_id)` and requires the signed player session.

- [ ] **Step 4: Implement GET/POST handlers**

GET returns `Cache-Control: no-store`. Join requires same origin, JSON, player cookie, idempotency key, and the join limit. No GET performs a write.

- [ ] **Step 5: Verify and commit snapshot APIs**

Run web tests/typecheck/build, stage Task 8 files, verify cached names, and commit:

```powershell
git commit -m "feat: add current game snapshot and join"
```

## Task 9: Implement Admin Preparation and Key-Point Extraction Lifecycle

**Files:**
- Create: `apps/web/src/server/game/admin-lifecycle.ts`
- Create: `apps/web/src/app/api/admin/status/route.ts`
- Create: `apps/web/src/app/api/admin/games/route.ts`
- Create: `apps/web/src/app/api/admin/games/current/preparation/route.ts`
- Create: `apps/web/src/app/api/admin/games/current/retry-extraction/route.ts`
- Test: `apps/web/src/server/game/admin-lifecycle.test.ts`
- Test: `apps/web/src/app/api/admin/games/route.test.ts`
- Test: `supabase/tests/database/003_lifecycle.test.sql`

**Interfaces:**
- Produces:

```ts
createPreparation(input: AdminPuzzleInput): Promise<{ gameId: string; status: 'WAITING' }>;
replacePreparation(gameId: string, input: AdminPuzzleInput): Promise<void>;
retryExtraction(gameId: string): Promise<void>;
activateGame(input: ActivateGameInput): Promise<void>;
```

```ts
type AdminPuzzleInput = { puzzleSurface: string; fullSolution: string };
type ActivateGameInput = {
  gameId: string;
  inputVersion: number;
  keyPoints: Array<{ content: string }>;
};
```

- [ ] **Step 1: Write failing lifecycle tests**

Cover one-open-game conflict, private WAITING surface/solution, input-version increment, one extraction job per version, retry without returning secrets, exact 3-5 activation, invalid/duplicate key-point rejection, ACTIVE surface publication, and frozen ACTIVE key points.

- [ ] **Step 2: Verify test failure**

Run web lifecycle tests and `pnpm exec supabase test db`.

- [ ] **Step 3: Implement transactional lifecycle operations**

Create/replace must write `private.game_secrets` and extraction job in the same transaction. Activation assigns server UUIDs, inserts immutable key points, sets total count, copies surface to `api.games`, and changes WAITING to ACTIVE atomically.

- [ ] **Step 4: Implement admin handlers**

All handlers require admin cookie, same origin, JSON, idempotency, rate limit, and a fresh Worker heartbeat. Admin status returns status/error codes only, never stored surface/solution/key-point content.

- [ ] **Step 5: Verify and commit admin lifecycle**

Run all Task 9 tests, typecheck, build, and database tests. Commit:

```powershell
git commit -m "feat: add admin game preparation lifecycle"
```

## Task 10: Build Durable Queue Leasing, Heartbeat, Retry, and Blocking

**Files:**
- Create: `services/judge-worker/package.json`
- Create: `services/judge-worker/tsconfig.json`
- Create: `services/judge-worker/vitest.config.ts`
- Create: `services/judge-worker/src/config.ts`
- Create: `services/judge-worker/src/db/client.ts`
- Create: `services/judge-worker/src/db/heartbeat.ts`
- Create: `services/judge-worker/src/db/queue.ts`
- Create: `services/judge-worker/src/worker.ts`
- Create: `services/judge-worker/src/index.ts`
- Test: `services/judge-worker/src/db/queue.test.ts`
- Test: `supabase/tests/database/004_queue.test.sql`

**Interfaces:**
- Produces:

```ts
writeHeartbeat(workerId: string, buildVersion: string): Promise<void>;
claimNextExtraction(workerId: string, now: Date): Promise<ClaimedExtraction | null>;
claimNextAction(workerId: string, now: Date): Promise<ClaimedAction | null>;
recordRetry(jobId: string, attempt: number, code: JudgeErrorCode): Promise<void>;
markBlocked(jobId: string, code: JudgeErrorCode): Promise<void>;
```

```ts
type ClaimedExtraction = {
  id: string;
  gameId: string;
  inputVersion: number;
  attempt: number;
  leaseOwner: string;
  leaseExpiresAt: Date;
};
type ClaimedAction = {
  id: string;
  gameId: string;
  playerId: string;
  sequenceNo: number;
  actionType: 'NORMAL_MESSAGE' | 'FINAL_ANSWER';
  attempt: number;
  leaseOwner: string;
  leaseExpiresAt: Date;
};
```

These Node/TypeScript file paths are executable only when Task 1 records a GO
for the current official Node runtime. If Task 1 selects another supported
runtime, stop and replace Tasks 10-13's Worker-specific file lists and commands
before implementation; do not create compatibility wrappers merely to retain
these paths.

- [ ] **Step 1: Write failing queue tests**

Test smallest sequence only, second Worker cannot claim later action, valid lease prevents duplicate claim, expired lease reclaims same head, backoffs 2/5/15 seconds, fourth failure BLOCKED, blocked head prevents later claims, and extraction jobs are limited to the current input version.

- [ ] **Step 2: Verify tests fail**

Run Worker tests and database queue tests.

- [ ] **Step 3: Implement short claim transactions**

Lock only the current head with `FOR UPDATE` and no `SKIP LOCKED`. Commit lease before any model call. Use a deterministic retry schedule function:

```ts
export const RETRY_SECONDS = [2, 5, 15] as const;
export function retryDelaySeconds(failedAttempt: number) {
  return RETRY_SECONDS[failedAttempt - 1] ?? null;
}
```

- [ ] **Step 4: Implement Worker loop and heartbeat**

Heartbeat every 10 seconds. Poll with bounded idle delay and abort cleanly on SIGTERM. Never run more than one action for the same current game.

`services/judge-worker/src/config.ts` validates these exact server-only keys:
`JUDGE_WORKER_DATABASE_URL`, `JUDGE_PROVIDER`, `JUDGE_MODEL`,
`JUDGE_API_BASE_URL`, `JUDGE_API_KEY`, `JUDGE_TIMEOUT_MS`, `WORKER_ID`, and
`BUILD_VERSION`. Configuration errors stop startup before writing a heartbeat.

- [ ] **Step 5: Verify and commit durable queue**

Run Worker tests/typecheck, database tests, and Docker build. Stage only Worker/queue test files and commit:

```powershell
git commit -m "feat: add durable serial judge queue"
```

## Task 11: Implement the Three Harness Semantic Skills and Benchmarks

**Files:**
- Create: `services/judge-worker/src/runtime/semantic-judge.ts`
- Create: `services/judge-worker/src/runtime/harness-semantic-judge.ts`
- Create: `services/judge-worker/src/runtime/fake-semantic-judge.ts`
- Create: `services/judge-worker/src/skills/key-point-extraction.ts`
- Create: `services/judge-worker/src/skills/question-judge.ts`
- Create: `services/judge-worker/src/skills/final-answer-judge.ts`
- Create: `services/judge-worker/src/skills/prompts/key-point-extraction-v1.txt`
- Create: `services/judge-worker/src/skills/prompts/question-judge-v1.txt`
- Create: `services/judge-worker/src/skills/prompts/final-answer-judge-v1.txt`
- Create: `services/judge-worker/src/skills/validate-result.ts`
- Create: `services/judge-worker/benchmarks/fixtures/semantic-policy.json`
- Create: `services/judge-worker/benchmarks/fixtures/key-point-extraction.json`
- Create: `services/judge-worker/benchmarks/fixtures/final-answer.json`
- Create: `services/judge-worker/benchmarks/fixtures/prompt-injection.json`
- Create: `services/judge-worker/benchmarks/run.ts`
- Test: `services/judge-worker/src/skills/key-point-extraction.test.ts`
- Test: `services/judge-worker/src/skills/question-judge.test.ts`
- Test: `services/judge-worker/src/skills/final-answer-judge.test.ts`
- Test: `services/judge-worker/src/skills/validate-result.test.ts`

**Interfaces:**
- Produces the approved `SemanticJudge` interface and validated result/error types.

- [ ] **Step 1: Write failing schema and semantic-policy tests**

Create explicit table-driven fixtures instead of relying on a prose reference to the design. The question-judging fixture matrix must include:

- a correct core claim and a semantically equivalent paraphrase → `YES`;
- a genuine indirect causal relationship → `YES`;
- a false core claim → `NO`;
- an explicit relationship claim that is true → `YES`, with assertions rejecting `NO`, `BOTH`, and `IRRELEVANT`;
- an explicit relationship claim that is false → `NO`, with assertions rejecting `YES`, `BOTH`, and `IRRELEVANT`;
- one question containing both correct and incorrect claims → `BOTH`;
- a genuinely semantically ambiguous question with one true and one false reading → `BOTH`;
- a clear true/false question where model uncertainty is not accepted as a `BOTH` fallback → the definite `YES` or `NO` verdict;
- a technically true but unhelpful detail → `IRRELEVANT`;
- that same detail phrased as “is this related to the solution?” → `NO`;
- a contextless pronoun or missing referent → `IRRELEVANT`.

The extraction fixture matrix must include valid outputs with exactly 3 and exactly 5 independently verifiable essential points, plus rejection cases for fewer than 3, more than 5, unsupported facts, non-essential facts, and mechanically split versions of one fact. Include a puzzle where the direct cause of death is not a separate key point so the extractor is not forced to invent one. Add a database test proving active key-point IDs and text are immutable after activation.

Also cover unknown/duplicate IDs, extra fields, Markdown-wrapped JSON rejection, empty output, prompt injection, 3/4 final failure, and 4/4 final success. Snapshot prompts so discovered state and conversation history cannot be added accidentally.

- [ ] **Step 2: Verify tests fail**

Run:

```powershell
pnpm --filter @turtle-soup/judge-worker test -- skills
```

- [ ] **Step 3: Implement versioned prompt builders**

Each builder accepts a typed input, labels all content as untrusted data, includes no player-facing explanation field, and returns the canonical JSON Schema. Question input includes surface, solution, all fixed key points, and current message only.

- [ ] **Step 4: Implement Harness adapter and strict validation**

Use the exact minimal runtime proven in Task 1. Prefer native JSON Schema if supported; otherwise parse one JSON value and validate it. Do not strip code fences, extract substrings, or call a repair model. Reject IDs not in the input allowlist.

- [ ] **Step 5: Implement benchmark runner**

Output JSONL rows containing provider, model, skill/prompt/schema versions, fixture ID, correctness, schema compliance, latency, token counts, and cost input fields. Do not log puzzle/answer text outside the local benchmark artifact.

- [ ] **Step 6: Verify and commit semantic skills**

Run unit tests, fake benchmark, typecheck, and Docker build. Real-provider benchmark requires explicit API credentials but is not a normal CI gate. Commit:

```powershell
git commit -m "feat: add structured semantic judge skills"
```

## Task 12: Implement Normal Message Submission and Atomic Result Commit

**Files:**
- Create: `apps/web/src/server/game/submit-message.ts`
- Create: `apps/web/src/app/api/game/current/messages/route.ts`
- Create: `services/judge-worker/src/processors/question-processor.ts`
- Create: `services/judge-worker/src/db/complete-question.ts`
- Test: `apps/web/src/server/game/submit-message.test.ts`
- Test: `apps/web/src/app/api/game/current/messages/route.test.ts`
- Test: `services/judge-worker/src/processors/question-processor.test.ts`
- Test: `services/judge-worker/src/db/complete-question.test.ts`
- Test: `supabase/tests/database/005_question_scoring.test.sql`

**Interfaces:**
- Produces:

```ts
submitMessage(input: SubmitMessageInput): Promise<PublicMessage>;
processQuestion(action: ClaimedQuestionAction): Promise<void>;
completeQuestion(input: CompleteQuestionInput): Promise<void>;
```

```ts
type SubmitMessageInput = {
  playerId: string;
  content: string;
  idempotencyKey: string;
  payloadDigest: string;
};
type ClaimedQuestionAction = ClaimedAction & { actionType: 'NORMAL_MESSAGE' };
type CompleteQuestionInput = {
  actionId: string;
  workerId: string;
  verdict: JudgeVerdict;
  fullyCoveredKeyPointIds: string[];
};
```

- [ ] **Step 1: Write failing submission/scoring tests**

Cover immediate PENDING row, server sequence allocation, question counters at receipt, irrelevant/error messages remaining in denominator, YES-only numerator, BOTH plus claim, multiple new claims, repeated claims with zero award, duplicate idempotency, and game-ended race rejection.

- [ ] **Step 2: Verify tests fail**

Run web, Worker, and database test filters for message/scoring.

- [ ] **Step 3: Implement message submission transaction**

Validate active game, heartbeat, player session, input, rate limit, and idempotency; allocate sequence; insert `api.messages` and `private.game_actions`; increment total/player question counts; return the public PENDING row.

- [ ] **Step 4: Implement Question Processor and atomic completion**

Load surface/solution/fixed key points, call the judge outside a transaction, validate IDs, then in one short transaction recheck ACTIVE/head/lease, lock key points in UUID order, insert claims, count successful inserts, update score/progress/message/stats, and complete the action.

- [ ] **Step 5: Verify and commit message flow**

Run relevant tests, full database suite, web/Worker typecheck and build, then commit:

```powershell
git commit -m "feat: add ordered message judging and scoring"
```

## Task 13: Implement Final Answers, Reveal, Force End, and Admin Retry

**Files:**
- Create: `apps/web/src/server/game/submit-final-answer.ts`
- Create: `apps/web/src/server/game/force-end.ts`
- Create: `apps/web/src/server/game/retry-blocked-action.ts`
- Create: `apps/web/src/app/api/game/current/final-answers/route.ts`
- Create: `apps/web/src/app/api/admin/games/current/force-end/route.ts`
- Create: `apps/web/src/app/api/admin/games/current/retry-blocked-action/route.ts`
- Create: `services/judge-worker/src/processors/final-answer-processor.ts`
- Create: `services/judge-worker/src/db/complete-final-answer.ts`
- Test: `apps/web/src/server/game/submit-final-answer.test.ts`
- Test: `apps/web/src/server/game/force-end.test.ts`
- Test: `apps/web/src/server/game/retry-blocked-action.test.ts`
- Test: `apps/web/src/app/api/game/current/final-answers/route.test.ts`
- Test: `apps/web/src/app/api/admin/games/current/force-end/route.test.ts`
- Test: `apps/web/src/app/api/admin/games/current/retry-blocked-action/route.test.ts`
- Test: `services/judge-worker/src/processors/final-answer-processor.test.ts`
- Test: `services/judge-worker/src/db/complete-final-answer.test.ts`
- Test: `supabase/tests/database/006_final_answer.test.sql`

**Interfaces:**
- Produces:

```ts
submitFinalAnswer(input: SubmitFinalAnswerInput): Promise<{ submissionId: string; sequenceNo: number; status: 'PENDING' }>;
completeFinalAnswer(input: CompleteFinalAnswerInput): Promise<void>;
forceEnd(input: ForceEndInput): Promise<void>;
retryBlockedHead(gameId: string): Promise<void>;
```

```ts
type SubmitFinalAnswerInput = {
  playerId: string;
  answer: string;
  idempotencyKey: string;
  payloadDigest: string;
};
type CompleteFinalAnswerInput = {
  actionId: string;
  workerId: string;
  coveredKeyPointIds: string[];
};
type ForceEndInput = {
  gameId: string;
  adminNickname: string;
  confirmation: 'FORCE_END';
};
```

- [ ] **Step 1: Write failing privacy and state tests**

Cover private body only, no read route, public failure without count/IDs/reason, 3/4 failure, 4/4 deterministic success, +2 exactly once, no +1 from final answer, reveal insertion, later-action cancellation, force-end zero +2, and late Worker commit rejection.

- [ ] **Step 2: Verify tests fail**

Run final-answer web/Worker/database tests.

- [ ] **Step 3: Implement final submission and processing**

Submission writes private body/action only and returns receipt metadata. Processor calls the judge outside the transaction; server code validates ID set and calls `isFinalAnswerSuccessful`.

- [ ] **Step 4: Implement success/failure/force-end transactions**

Failure publishes only a safe event. Success and force end copy solution/key points into reveal tables and cancel later actions. Force end requires body `{ "confirmation": "FORCE_END" }` and an admin session.

- [ ] **Step 5: Implement blocked-head retry**

Admin retry changes only the current BLOCKED head to RETRY with cleared lease and immediate availability; it never changes verdict, score, or progress.

- [ ] **Step 6: Verify and commit completion flows**

Run all relevant suites/builds and commit:

```powershell
git commit -m "feat: add private final answers and game ending"
```

## Task 14: Add Supabase Realtime Snapshot Invalidation

**Files:**
- Create: `apps/web/src/lib/supabase-browser.ts`
- Create: `apps/web/src/hooks/use-game-realtime.ts`
- Create: `apps/web/src/components/game/game-client.tsx`
- Create: `apps/web/src/components/game/connection-status.tsx`
- Test: `apps/web/src/hooks/use-game-realtime.test.tsx`
- Test: `apps/web/src/components/game/game-client.test.tsx`

**Interfaces:**
- Produces:

```ts
useGameRealtime(initial: PublicGameSnapshot | null): {
  snapshot: PublicGameSnapshot | null;
  connection: 'CONNECTED' | 'RECONNECTING' | 'OFFLINE';
  refresh(): Promise<void>;
};
```

- [ ] **Step 1: Write failing hook tests**

Use a fake Supabase channel and fake timers. Test 100 ms coalescing, one snapshot refetch for a transaction's multiple events, immediate reconnect refetch, five-second offline polling, cleanup, preservation of local SENDING rows, and preservation of private in-memory final-answer state.

- [ ] **Step 2: Verify tests fail**

Run the web hook/component test filter.

- [ ] **Step 3: Implement browser client and invalidation hook**

Use only URL/publishable key. Subscribe to named public tables filtered by current game ID. Treat events as invalidation; never read private data or mutate server state from payloads.

- [ ] **Step 4: Verify and commit Realtime foundation**

Run tests/typecheck/build and commit:

```powershell
git commit -m "feat: add realtime snapshot synchronization"
```

## Task 15: Build the Responsive Player Dashboard

**Files:**
- Modify: `apps/web/src/app/page.tsx`
- Modify: `apps/web/src/app/globals.css`
- Create: `apps/web/src/components/game/nickname-gate.tsx`
- Create: `apps/web/src/components/game/game-header.tsx`
- Create: `apps/web/src/components/game/puzzle-panel.tsx`
- Create: `apps/web/src/components/game/message-feed.tsx`
- Create: `apps/web/src/components/game/message-row.tsx`
- Create: `apps/web/src/components/game/message-composer.tsx`
- Create: `apps/web/src/components/game/final-answer-modal.tsx`
- Create: `apps/web/src/components/game/player-stats-panel.tsx`
- Create: `apps/web/src/components/game/game-reveal-panel.tsx`
- Test: `apps/web/src/components/game/nickname-gate.test.tsx`
- Test: `apps/web/src/components/game/message-row.test.tsx`
- Test: `apps/web/src/components/game/message-composer.test.tsx`
- Test: `apps/web/src/components/game/final-answer-modal.test.tsx`
- Test: `apps/web/src/components/game/player-stats-panel.test.tsx`
- Test: `apps/web/src/components/game/game-reveal-panel.test.tsx`
- Test: `apps/web/src/components/game/game-client.integration.test.tsx`

**Interfaces:**
- Consumes: public snapshot, player session endpoints, message/final-answer receipts, and Realtime hook.
- Produces: desktop/mobile dashboard with no chatbot/AI reply UI.

- [ ] **Step 1: Write failing interaction tests**

Test nickname gate, WAITING without surface, ACTIVE puzzle/progress, message row with reaction on original row, SENDING/PENDING/JUDGED/ERROR/CANCELLED states, deterministic emoji, points, Challenge placeholder only, stats sort/hit rate, modal keyboard behavior, failed-answer local text visibility, refresh disappearance, and ENDED reveal/input disablement.

- [ ] **Step 2: Verify tests fail**

Run `pnpm --filter @turtle-soup/web test -- components/game`.

- [ ] **Step 3: Implement semantic component structure**

Use CSS Grid for desktop message rows and a fixed reaction column on mobile. Use no chat bubbles, AI avatar, AI message, or hidden-by-default puzzle. Stats move to an accessible drawer below the desktop breakpoint.

- [ ] **Step 4: Implement optimistic/local-private states**

Generate a UUID idempotency key per submit. Replace local SENDING row with the returned PENDING row. Keep final-answer text only in component memory keyed by returned sequence; show it only to the submitting client after its failure event; clear on success/unmount/refresh.

- [ ] **Step 5: Implement accessibility and responsive CSS**

Add visible focus, focus-trapped modal, Escape close, restored trigger focus, polite verdict live region, icon text alternatives, reduced motion, and tested layouts at 1440x900 and 390x844.

- [ ] **Step 6: Verify and commit player UI**

Run component tests, typecheck, lint, and production build. Commit:

```powershell
git commit -m "feat: build multiplayer game dashboard"
```

## Task 16: Build the Minimal Admin Interface

**Files:**
- Create: `apps/web/src/app/admin/page.tsx`
- Create: `apps/web/src/components/admin/admin-panel.tsx`
- Create: `apps/web/src/components/admin/admin-login-form.tsx`
- Create: `apps/web/src/components/admin/game-preparation-form.tsx`
- Create: `apps/web/src/components/admin/extraction-status.tsx`
- Create: `apps/web/src/components/admin/force-end-control.tsx`
- Test: `apps/web/src/components/admin/admin-login-form.test.tsx`
- Test: `apps/web/src/components/admin/game-preparation-form.test.tsx`
- Test: `apps/web/src/components/admin/extraction-status.test.tsx`
- Test: `apps/web/src/components/admin/force-end-control.test.tsx`
- Test: `apps/web/src/components/admin/admin-panel.integration.test.tsx`

**Interfaces:**
- Consumes: admin routes from Tasks 7, 9, and 13.
- Produces: login, create/replace WAITING input, extraction retry, blocked-head retry, and confirmed force end without revealing stored secrets.

- [ ] **Step 1: Write failing admin UI tests**

Test login, safe error codes, no stored solution/key-point render, WAITING replacement requiring both fields, extraction retry, blocked action retry, two-step force confirmation, ACTIVE create conflict, and idempotent button disablement.

- [ ] **Step 2: Verify tests fail**

Run admin component tests.

- [ ] **Step 3: Implement the minimal admin page**

Do not add history, puzzle library, generated puzzle, analytics, or key-point editing/preview. Clear admin secret from component state after login response.

- [ ] **Step 4: Verify and commit admin UI**

Run tests/typecheck/lint/build and commit:

```powershell
git commit -m "feat: add minimal game administration"
```

## Task 17: Full Security, Concurrency, E2E, and Deployment Verification

**Files:**
- Modify: `package.json`
- Modify: `pnpm-lock.yaml`
- Create: `e2e/playwright.config.ts`
- Create: `e2e/helpers/admin.ts`
- Create: `e2e/helpers/player.ts`
- Create: `e2e/multiplayer-flow.spec.ts`
- Create: `e2e/privacy.spec.ts`
- Create: `e2e/concurrency.spec.ts`
- Create: `e2e/mobile.spec.ts`
- Create: `scripts/verify-public-boundary.ps1`
- Create: `scripts/verify-ten-player-load.mjs`
- Create: `docs/operations/environment.md`
- Create: `docs/operations/local-development.md`
- Create: `docs/operations/deployment.md`

**Interfaces:**
- Consumes: the complete application.
- Produces: repeatable proof for all 19 acceptance steps, privacy boundaries, queue order, 10-active-player verification target, builds, and Docker startup/recovery.

- [ ] **Step 1: Write failing two-browser E2E tests**

Add `@playwright/test@1.62.1` to root development dependencies and add root
scripts `test:e2e` and `verify:public-boundary` before creating the specs.

Use separate browser contexts for Cups and Alice. Encode all 19 design acceptance steps, including immediate PENDING visibility, first/repeat hit scoring, rapid sequence order, failed final privacy, successful +2, reveal, refresh persistence, and next-game creation.

- [ ] **Step 2: Write negative privacy tests**

Inspect HTTP JSON, Realtime payloads, DOM, and built client assets for solution/key-point/final-answer/API-key/admin-secret leakage. Verify anon cannot read `private` or mutate `api`.

- [ ] **Step 3: Write concurrency/recovery tests**

Run two Workers with a Fake Judge. Prove earlier receipt wins, failed head blocks, lease expiry reclaims the same head, duplicate completion is idempotent, final answer waits behind earlier message, and force end rejects late completion.

- [ ] **Step 4: Run the 10-active-player verification target**

The load script creates 10 distinct sessions and submits bounded messages rapidly. Assert no 11-player admission check exists, no duplicate score, no sequence reorder, and no lost public rows.

- [ ] **Step 5: Verify the complete system**

Run:

```powershell
pnpm test
pnpm typecheck
pnpm lint
pnpm build
pnpm exec supabase db reset
pnpm exec supabase test db
pnpm exec playwright test --config e2e/playwright.config.ts
docker build -f services/judge-worker/Dockerfile -t turtle-soup-judge-worker .
powershell -File scripts/verify-public-boundary.ps1
node scripts/verify-ten-player-load.mjs
```

Expected: all commands pass. If a real provider is unavailable, Fake Judge E2E must still pass and the real-provider benchmark remains a separately recorded credential-dependent check.

- [ ] **Step 6: Verify recovery manually**

Start a message, stop the Worker after lease acquisition, wait for lease expiry, restart the Worker, and confirm the same action completes exactly once with no later overtaking.

- [ ] **Step 7: Document environments and deployment**

List every required environment variable, which service owns it, whether it is secret, local setup, Vercel configuration, Supabase role URLs, Worker Docker command, health/retry behavior, and rollback procedure. Do not include actual secret values.

- [ ] **Step 8: Final staged review and commit**

Run:

```powershell
git status --short
git diff --check
git add -- e2e scripts docs/operations
git diff --cached --name-only
git commit -m "test: verify multiplayer turtle soup mvp"
```

## Final Verification Checklist

This checklist is the implementation plan's direct MVP Acceptance gate.

- [ ] Harness decision is GO and the exact runtime/version is pinned.
- [ ] All 19 acceptance steps pass with two browser contexts.
- [ ] Every Semantic Judging Policy rule has a fixture and expected verdict.
- [ ] Key-point extraction fixtures enforce every extraction policy.
- [ ] Database/RLS negative tests prove hidden data is unreachable.
- [ ] Queue order, lease recovery, blocking, and idempotency tests pass.
- [ ] Failed final-answer text is visible only in the submitting page's memory and disappears on refresh.
- [ ] The 10-active-player run passes and player 11 is not hard-rejected.
- [ ] Next.js production build and Worker Docker build pass.
- [ ] Public payload/bundle/log audit finds no solution, key point, final-answer body, admin secret, provider key, or service credential.
- [ ] Git worktree is clean and every task commit contains only its named files.

## Spec Coverage Matrix

| Approved design area | Implementing tasks |
|---|---|
| Repository/service architecture and runtime gate | 1-3, 6, 10 |
| Identity and administration | 7, 9, 16 |
| WAITING/ACTIVE/ENDED lifecycle | 4, 8, 9, 13 |
| Public/private schema, grants, RLS, Realtime | 4, 5, 8, 14 |
| Durable serial queue, leases, retry, blocking | 10, 12, 13, 17 |
| Key-point extraction policy | 9, 11, 17 |
| Question semantic policy and hit detection | 3, 11, 12, 17 |
| Private final answer and deterministic success | 3, 11, 13, 15, 17 |
| HTTP validation, idempotency, abuse protection | 6-9, 12, 13 |
| Desktop/mobile multiplayer dashboard | 14, 15 |
| Minimal admin UI | 16 |
| Privacy, concurrency, E2E, deployment readiness | 5, 17 |
