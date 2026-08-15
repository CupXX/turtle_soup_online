# Semantic Policy, Player Experience, and Challenge Review Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship Question Judge v6, Key Point Extraction v3, the confirmed player-facing improvements, and deterministic five-judgment challenges, then run the supplied 30-case fixture against Luna none and Luna medium as the final frozen benchmark.

**Architecture:** Upgrade semantic behavior through versioned prompt-policy changes without changing judge schemas or the fixed four-field Question Judge input. Keep the existing server snapshot and game components as the public source of truth; presentation tasks remain scoped to existing components. Extend the current idempotent action queue with private judgment storage, a pure five-vote resolver, and one worker transaction for verdict, key-point, score, and statistics reconciliation. Only after every implementation and local verification task passes, freeze the commit and run the new two-configuration live benchmark.

**Tech Stack:** Next.js 16, React 19, TypeScript, Testing Library, Vitest, PostgreSQL/Supabase, OpenAI Responses API.

## Global Constraints

- Create `question-judge-v6`; preserve `question-judge-v5` prompt text and historical benchmark artifacts unchanged.
- Create `key-point-extraction-v3`; preserve the v2 policy as a frozen prompt snapshot and do not change the extraction result schema.
- Question Judge still receives exactly `puzzle_surface`, `full_solution`, fixed `key_points`, and `current_message`; it never receives identity, nickname, chat history, score, or discovered-key-point state.
- Verdict and key-point coverage remain independent. A true proposition within a `BOTH` message may cover key points.
- Prefer the ordinary contextual reading. Do not inflate `BOTH`, and do not turn arbitrary unspecified background attributes into `NO`.
- Production Question Judge routing remains GPT-5.6 Luna with reasoning effort `medium` after the v6 rollout.
- ACTIVE-game key points remain frozen. Extraction v3 applies only while preparing a new game.
- Player statistics must show, in order: 玩家、分数（累计分）、本局提问数、命中率。
- “本局提问数” means the player’s `questionCount` for the current game, not lifetime questions and not the global game total.
- Preserve the existing score sorting, hit-rate calculation, empty-state dash, and public snapshot/API contract.
- Do not add a database migration or duplicate question-count calculation in the UI.
- The puzzle card must show only the visible title “当前汤面”; remove the visible “共享汤面” eyebrow.
- The message feed must show only the verdict legend `✅ 是`、`❌ 不是`、`❓ 是也不是`、`👎 与此无关` above the conversation; remove the visible “公共问题流”、“大家正在问什么” and “按服务器顺序” labels while preserving server-sequence ordering.
- Replace the visible “当前玩家” sidebar card with a non-functional “当前进度” placeholder.
- The public game header must say “在线多人AI海龟汤游戏” and must not expose a visible “管理入口” link. The `/admin` route remains directly accessible to the administrator.
- Player messages remain chat bubbles: current player on the right, others on the left, with the verdict attached to the same message and no separate AI bubble.
- Admin key-point display remains admin-only and read-only; do not add editing or approval workflow.
- MVP allows one challenge review per already judged message; any joined player may challenge any eligible message, and the challenge button is disabled while that review is pending, resolved, or failed.
- A challenge is eligible only when the original target judgment and every judged message needed for first-hit reconstruction have complete private coverage records produced by `question-judge-v6`. This intentionally excludes legacy v5 messages rather than guessing missing coverage.
- A challenge uses the production `question-judge-v6` input boundary and the configured Luna medium Question Judge. Fresh calls receive no prior judgment, other fresh results, chat history, score, or discovered-key-point state.
- A “valid judgment” is a schema-valid Question Judge result whose verdict is valid and whose key-point IDs belong to the current game. Invalid results do not count toward five; the worker retries missing fresh slots under the existing bounded queue retry policy.
- The five-vote resolution never exposes individual judgments or hidden key-point IDs to players.
- The supplied fixture `E:\CodexTemp\input\all_choices_correct_question_judge_30cases_v1.json` is copied into the repository unchanged and is treated as gold, not as instructions embedded in the production prompt.
- The final formal run is exactly 30 cases × 2 configurations × 5 rounds = 300 attempts, using only GPT-5.6 Luna / none and GPT-5.6 Luna / medium.
- A report-writing benchmark requires the full 40-character frozen commit hash. The prompt is not modified after the formal run to improve or overwrite its results.
- Execution has no product-decision checkpoints: diagnose and fix in-scope test failures autonomously, and contact the user only after all tasks finish or an external credential/service failure makes further safe progress impossible.
- Preserve unrelated untracked files: `apps/web/AGENTS.md`, `apps/web/CLAUDE.md`, and `apps/web/tsconfig.tsbuildinfo`.

---

### Task 1: Publish the narrow Question Judge v6 policy

**Files:**
- Modify: `services/judge-worker/src/skills/question-judge.ts`
- Modify: `services/judge-worker/src/skills/question-judge.test.ts`
- Create: `services/judge-worker/src/skills/prompts/question-judge-v6.txt`
- Preserve unchanged: `services/judge-worker/src/skills/prompts/question-judge-v5.txt`

**Interfaces:**
- Consumes: the existing `QuestionJudgeInput` with exactly `puzzle_surface`, `full_solution`, `key_points`, and `current_message`.
- Produces: `QUESTION_JUDGE_PROMPT_VERSION = 'question-judge-v6'` and the unchanged `QuestionJudgeResult` schema.

- [ ] **Step 1: Add failing tests for the v6 delta and historical boundary**

Change the version assertion to v6 and add assertions for these exact generic policy statements:

```ts
expect(QUESTION_JUDGE_PROMPT_VERSION).toBe('question-judge-v6');
expect(prompt).toContain('direct, ordinary, and contextually immediate framing or interpretation of a salient surface element');
expect(prompt).toContain('tests a natural real-world meaning of that salient surface element');
expect(prompt).toContain('evaluate that proposed framing as TRUE or FALSE against the canonical causal story');
expect(prompt).toContain('NO means that a puzzle-relevant direction is wrong');
expect(prompt).toContain('not an absolute claim about every unspecified fact in the fictional world');
expect(prompt).toContain('The surface element must be central to the apparent anomaly');
expect(prompt).toContain('Do not make an arbitrary association puzzle-relevant');
expect(prompt).not.toContain('选择题');
expect(prompt).not.toContain('试卷');
```

Keep every existing v5 invariant assertion: mixed true/false propositions, intention-scope `BOTH`, ordinary-reading preference, relevance-direction handling, independent KP coverage, multi-KP return, and narrow surface-event slot binding.

- [ ] **Step 2: Run the prompt test and verify RED**

Run:

```powershell
pnpm --filter @turtle-soup/judge-worker test -- src/skills/question-judge.test.ts
```

Expected: FAIL because production still identifies itself as v5 and lacks the salient-surface-framing policy.

- [ ] **Step 3: Add only the missing semantic rule**

Set the version to `question-judge-v6`. In `PHASE B - EVALUATE`, after the existing explicit relevance-direction rule and before the existing standalone competing-explanation rule, add this policy without deleting or rewriting the stable v5 sections:

```text
A current message may be puzzle-relevant when it proposes a direct, ordinary, and contextually immediate framing or interpretation of a salient surface element.
This includes a message that tests a natural real-world meaning of that salient surface element even when it does not explicitly state a causal relation.
When that framing is a normal competing reading of the surface wording, evaluate that proposed framing as TRUE or FALSE against the canonical causal story.
If the framing conflicts with the canonical solution, evaluate it as FALSE, so the final verdict is normally NO rather than IRRELEVANT.
The surface element must be central to the apparent anomaly, and the proposed framing must be direct, ordinary, and strongly suggested by the wording in context.
Do not make an arbitrary association puzzle-relevant merely because a hypothetical connection can be imagined.
NO means that a puzzle-relevant direction is wrong; it is not an absolute claim about every unspecified fact in the fictional world.
```

Do not add the supplied puzzle, “选择题”, “试卷”, or any case ID to the production prompt. Do not alter the coverage section.

- [ ] **Step 4: Freeze the exact production policy text**

Create `question-judge-v6.txt` from the policy prefix of `buildQuestionJudgePrompt`, ending immediately before the runtime `UNTRUSTED_DATA:` JSON payload. Add a test that reads the snapshot and compares it byte-for-byte:

```ts
const policy = prompt.split('\nUNTRUSTED_DATA:\n')[0];
expect(`${policy}\n`).toBe(readFileSync(new URL('./prompts/question-judge-v6.txt', import.meta.url), 'utf8'));
```

The existing v5 snapshot must remain unchanged according to `git diff -- services/judge-worker/src/skills/prompts/question-judge-v5.txt`.

- [ ] **Step 5: Run focused verification and commit**

Run:

```powershell
pnpm --filter @turtle-soup/judge-worker test -- src/skills/question-judge.test.ts src/skills/validate-result.test.ts
pnpm --filter @turtle-soup/judge-worker typecheck
git diff --check
```

Expected: v6 prompt tests pass and the output schema remains `judge-schema-v1`.

Commit only the prompt, test, and v6 snapshot:

```powershell
git add -- services/judge-worker/src/skills/question-judge.ts services/judge-worker/src/skills/question-judge.test.ts services/judge-worker/src/skills/prompts/question-judge-v6.txt
git diff --cached --name-only
git commit -m "feat: add question judge v6 policy"
```

---

### Task 2: Publish Key Point Extraction v3 around independent discoveries

**Files:**
- Modify: `services/judge-worker/src/skills/key-point-extraction.ts`
- Modify: `services/judge-worker/src/skills/key-point-extraction.test.ts`
- Create: `services/judge-worker/src/skills/prompts/key-point-extraction-v2.txt`
- Create: `services/judge-worker/src/skills/prompts/key-point-extraction-v3.txt`

**Interfaces:**
- Consumes: the unchanged `KeyPointExtractionInput` containing only `puzzle_surface` and `full_solution`.
- Produces: `KEY_POINT_EXTRACTION_PROMPT_VERSION = 'key-point-extraction-v3'`; the result remains `{ key_points: Array<{ content: string }> }` with exactly 3–5 items.

- [ ] **Step 1: Preserve v2 and add failing v3 policy assertions**

Before editing production text, save the current v2 policy prefix as `key-point-extraction-v2.txt`. Change the version assertion to v3 and add:

```ts
expect(KEY_POINT_EXTRACTION_PROMPT_VERSION).toBe('key-point-extraction-v3');
expect(prompt).toContain('decompose full_solution into atomic hidden facts and causal relationships');
expect(prompt).toContain('independently discoverable and independently score-worthy');
expect(prompt).toContain('INDEPENDENT DISCOVERY TEST');
expect(prompt).toContain('PARTIAL COVERAGE SANITY TEST');
expect(prompt).toContain('natural yes-or-no question');
expect(prompt).toContain('Avoid unnecessary conjunctive key points');
expect(prompt).toContain('Separate facts that can be naturally asked, discovered, and rewarded independently');
expect(prompt).toContain('Do not split one inseparable relation into fragments');
expect(prompt).toContain('HIDDEN FACT AND CAUSAL BRIDGE');
expect(prompt).not.toContain('蚊子');
expect(prompt).not.toContain('选择题');
```

Retain all current assertions for 3–5 points, support by the full solution, no surface restatement, no invented details, chronology, and no immediate-consequence KP.

- [ ] **Step 2: Run the extraction prompt test and verify RED**

Run:

```powershell
pnpm --filter @turtle-soup/judge-worker test -- src/skills/key-point-extraction.test.ts
```

Expected: FAIL because production still identifies itself as v2 and has no independent-discovery rules.

- [ ] **Step 3: Implement the v3 extraction policy without changing the schema**

Set the version to `key-point-extraction-v3`. Replace the single ambiguous “do not mechanically split” sentence with the following bounded policy while retaining the existing rules around 3–5 points and surface/outcome exclusions:

```text
First silently decompose full_solution into atomic hidden facts and causal relationships.
Select final key points that are independently discoverable and independently score-worthy.
INDEPENDENT DISCOVERY TEST: a player should be able to ask a natural yes-or-no question that fully discovers this point without also having to state another selected point.
PARTIAL COVERAGE SANITY TEST: if one conjunct can be discovered and meaningfully rewarded on its own, do not bind it to a separate conjunct in the same key point.
Avoid unnecessary conjunctive key points. Separate facts that can be naturally asked, discovered, and rewarded independently.
Do not split one inseparable relation into fragments, and do not create a fragment that is not meaningful or score-worthy on its own.
HIDDEN FACT AND CAUSAL BRIDGE: a hidden fact may stand alone; select a causal bridge separately only when that relationship itself explains the surface anomaly and is independently discoverable.
Prefer the hidden puzzle mechanism over background facts, surface restatements, and consequences that become automatic once earlier points are known.
```

Keep “If three sufficient points reconstruct the solution, return exactly three.” Do not add new fields such as category, rationale, confidence, or dependencies.

- [ ] **Step 4: Freeze v3 text and prove the schema is unchanged**

Create `key-point-extraction-v3.txt` from the exact policy prefix and compare it byte-for-byte in the test, using the same split-before-runtime-data pattern as Task 1. Add an assertion against `KEY_POINT_EXTRACTION_SCHEMA` proving `key_points` is still the only required output property and its item count remains 3–5.

- [ ] **Step 5: Run focused verification and commit**

Run:

```powershell
pnpm --filter @turtle-soup/judge-worker test -- src/skills/key-point-extraction.test.ts src/skills/validate-result.test.ts
pnpm --filter @turtle-soup/judge-worker typecheck
git diff --check
```

Commit only the extraction policy artifacts:

```powershell
git add -- services/judge-worker/src/skills/key-point-extraction.ts services/judge-worker/src/skills/key-point-extraction.test.ts services/judge-worker/src/skills/prompts/key-point-extraction-v2.txt services/judge-worker/src/skills/prompts/key-point-extraction-v3.txt
git diff --cached --name-only
git commit -m "feat: add key point extraction v3 policy"
```

---

### Task 3: Add the supplied 30-case fixture and a two-Luna benchmark harness

**Files:**
- Create: `services/judge-worker/benchmarks/fixtures/all-choices-correct-question-judge-v1-30cases.json`
- Create: `services/judge-worker/benchmarks/all-choices-correct-question-judge-regression.ts`
- Create: `services/judge-worker/benchmarks/all-choices-correct-question-judge-regression.test.ts`
- Create: `services/judge-worker/benchmarks/all-choices-correct-question-judge-live.ts`
- Create: `services/judge-worker/benchmarks/all-choices-correct-question-judge-live.test.ts`
- Modify: `services/judge-worker/benchmarks/question-judge-regression.ts`
- Modify: `services/judge-worker/benchmarks/question-judge-regression.test.ts`
- Modify: `services/judge-worker/package.json`
- Modify: `package.json`

**Interfaces:**
- Consumes: the exact supplied JSON file at `E:\CodexTemp\input\all_choices_correct_question_judge_30cases_v1.json` and the production v6 prompt builder.
- Produces: a validated fixture adapter, a no-retry live runner, raw JSON results, and a Markdown report for exactly Luna none and Luna medium.

- [ ] **Step 1: Copy the gold fixture unchanged and add validator tests**

Copy the supplied JSON byte-for-byte to the fixture path. Do not rewrite its gold fields, case IDs, coverage, or summary. Add a validator for this exact shape:

```ts
type AllChoicesCorrectFixture = {
  dataset: 'all_choices_correct_question_judge_regression_v1';
  puzzle_surface: string;
  full_solution: string;
  key_points: Array<{ id: 'KP1' | 'KP2' | 'KP3'; content: string }>;
  cases: Array<{
    id: string;
    question: string;
    expectedVerdict: JudgeVerdict;
    expectedCoverage: Array<'KP1' | 'KP2' | 'KP3'>;
    policyTags: string[];
  }>;
  summary: {
    caseCount: 30;
    verdictDistribution: Record<JudgeVerdict, number>;
    coverageHitCounts: Record<'KP1' | 'KP2' | 'KP3', number>;
    designNote: string;
  };
};
```

The validator must reject a wrong dataset name, any case count other than 30, duplicate case IDs, invalid verdicts, duplicate/unknown coverage IDs, changed key points, and a summary whose recomputed verdict or coverage totals differ. The approved distribution is YES 15, NO 9, IRRELEVANT 5, BOTH 1; KP hits are KP1 2, KP2 5, KP3 2.

- [ ] **Step 2: Run the fixture test and verify RED, then implement the adapter**

Run:

```powershell
pnpm --filter @turtle-soup/judge-worker test -- benchmarks/all-choices-correct-question-judge-regression.test.ts
```

Expected: FAIL because the adapter does not exist. Implement a normalization function that maps `content` to the existing internal key-point `text` field and maps camelCase gold names to `expected_verdict`, `expected_coverage`, and `policy_tags`. It must not alter semantic content.

- [ ] **Step 3: Add a scoped surface-interpretation failure category**

Extend the existing benchmark-only `FailureCategory` with `SURFACE_INTERPRETATION_FAILURE`. When a verdict is wrong and `policyTags` contains `surface_interpretation`, classify it with this category before the generic semantic-entailment fallback. Keep all existing mosquito categories and report fields stable.

- [ ] **Step 4: Write the failing live-runner tests**

Define only these configurations:

```ts
export const ALL_CHOICES_MODEL_CONFIGURATIONS = [
  { label: 'GPT-5.6 Luna / none', provider: 'openai', model: 'gpt-5.6-luna', reasoningEffort: 'none' as const },
  { label: 'GPT-5.6 Luna / medium', provider: 'openai', model: 'gpt-5.6-luna', reasoningEffort: 'medium' as const },
] as const;
```

Tests must prove:

```ts
expect(result.attempts).toHaveLength(300);
expect(factory).toHaveBeenCalledTimes(2);
expect(calls.slice(0, 150).every((call) => call.label === 'GPT-5.6 Luna / none')).toBe(true);
expect(calls.slice(150).every((call) => call.label === 'GPT-5.6 Luna / medium')).toBe(true);
expect(calls.every(({ input }) => Object.keys(input).sort().join('|') === 'current_message|full_solution|key_points|puzzle_surface')).toBe(true);
```

Also prove that `--no-write` makes no file writes, one thrown call becomes one invalid attempt without selective retry, and report-writing refuses to start before any model call unless `BENCHMARK_FROZEN_COMMIT` is a full 40-character hash.

- [ ] **Step 5: Implement the runner and report paths without calling models yet**

Reuse the existing OpenAI Responses benchmark client and shared attempt evaluation/summarization. Default to five rounds and run configurations, rounds, and cases sequentially. Use these new paths:

```text
docs/reports/2026-08-16-all-choices-correct-question-judge-v6-30case-2config-5round.md
docs/reports/2026-08-16-all-choices-correct-question-judge-v6-30case-2config-5round.results.json
```

The Markdown report must contain fixed KPs, verdict accuracy, KP coverage accuracy, strict joint accuracy, valid rate, average/P50/P95 latency, actual verdict distribution, per-case stability, failure categories, input/output token totals, provider cost when present, and an interpretation section. Missing authoritative cost stays `N/A`; do not estimate it.

Add scripts:

```json
{
  "benchmark:all-choices:30": "tsx benchmarks/all-choices-correct-question-judge-live.ts"
}
```

in the worker package and:

```json
{
  "benchmark:all-choices:30": "node --env-file=.env.local --import tsx services/judge-worker/benchmarks/all-choices-correct-question-judge-live.ts"
}
```

at the repository root.

- [ ] **Step 6: Run harness verification and commit without a formal API run**

Run:

```powershell
pnpm --filter @turtle-soup/judge-worker test -- benchmarks/question-judge-regression.test.ts benchmarks/all-choices-correct-question-judge-regression.test.ts benchmarks/all-choices-correct-question-judge-live.test.ts
pnpm --filter @turtle-soup/judge-worker typecheck
git diff --check
```

Commit the fixture and harness, but do not create formal report artifacts yet:

```powershell
git add -- services/judge-worker/benchmarks/fixtures/all-choices-correct-question-judge-v1-30cases.json services/judge-worker/benchmarks/all-choices-correct-question-judge-regression.ts services/judge-worker/benchmarks/all-choices-correct-question-judge-regression.test.ts services/judge-worker/benchmarks/all-choices-correct-question-judge-live.ts services/judge-worker/benchmarks/all-choices-correct-question-judge-live.test.ts services/judge-worker/benchmarks/question-judge-regression.ts services/judge-worker/benchmarks/question-judge-regression.test.ts services/judge-worker/package.json package.json
git diff --cached --name-only
git commit -m "test: add all choices question judge benchmark"
```

---

### Task 4: Run pre-freeze semantic regression and switch production to v6/v3

**Files:**
- Create: `services/judge-worker/benchmarks/fixtures/key-point-extraction-v3-regression.json`
- Create: `services/judge-worker/benchmarks/key-point-extraction-v3-live.ts`
- Create: `services/judge-worker/benchmarks/key-point-extraction-v3-live.test.ts`
- Modify: `services/judge-worker/package.json`
- Modify: `package.json`
- Create after the run: `docs/reports/2026-08-16-key-point-extraction-v3-regression.md`
- Modify only if a pre-freeze case proves the generic wording insufficient: the v6/v3 prompt, matching snapshot, and prompt test files from Tasks 1–2

**Interfaces:**
- Consumes: the two fixed puzzle surface/solution pairs, production Luna medium extraction, and the two-Luna Question Judge runner in no-write mode.
- Produces: a reviewed v3 extraction report, a targeted v6 question preflight, and a frozen production semantic policy before UI/challenge work begins.

- [ ] **Step 1: Add the two-puzzle extraction fixture and runner tests**

The fixture contains these semantic targets, used for human-readable review rather than keyword scoring:

```text
mosquito:
  1. 他是被蚊子叮醒的。
  2. 那一巴掌是为了打蚊子，而且没有打中。
  3. 他随后点燃了蚊香。

all-choices-correct:
  1. 所谓选择题是凶手让被害人的母亲猜孩子在哪个房间。
  2. 被害人的尸体已经被分尸。
  3. 尸块分散在多个候选房间，因此选哪个房间都能被说成正确。
```

The runner uses only GPT-5.6 Luna / medium, runs each puzzle five times, validates schema, item count 3–5, non-empty normalized content, and no exact duplicate points, then writes every raw extracted point plus latency/token metadata to the report. It must not pretend to semantically grade paraphrases with keyword matching.

Add these exact scripts before running it:

```json
// services/judge-worker/package.json
"benchmark:key-points:v3": "tsx benchmarks/key-point-extraction-v3-live.ts"

// package.json
"benchmark:key-points:v3": "node --env-file=.env.local --import tsx services/judge-worker/benchmarks/key-point-extraction-v3-live.ts"
```

- [ ] **Step 2: Verify local configuration without printing secrets**

Run this value-only assertion without printing any secret:

```powershell
node --env-file=.env.local -e "const required=['OPENAI_API_KEY','JUDGE_API_BASE_URL']; for (const name of required) if (!process.env[name]) throw new Error(name+' missing'); const expected={JUDGE_PROVIDER:'openai-responses',JUDGE_KEY_POINT_EXTRACTION_MODEL:'gpt-5.6-luna',JUDGE_KEY_POINT_EXTRACTION_REASONING_EFFORT:'medium',JUDGE_QUESTION_MODEL:'gpt-5.6-luna',JUDGE_QUESTION_REASONING_EFFORT:'medium',JUDGE_FINAL_ANSWER_MODEL:'gpt-5.6-luna',JUDGE_FINAL_ANSWER_REASONING_EFFORT:'medium'}; for (const [name,value] of Object.entries(expected)) if (process.env[name]!==value) throw new Error(name+' mismatch'); console.log('semantic configuration present')"
```

Expected: only `semantic configuration present`; no key or secret value is printed.

- [ ] **Step 3: Run a targeted v6 no-write preflight**

Run one round across both Luna configurations for the highest-risk cases:

```powershell
pnpm benchmark:all-choices:30 -- --rounds 1 --cases "school_exam,on_test_paper,tv_quiz,four_options,answerer_adult,is_really_choice_question" --no-write
```

Expected: 12 schema-valid attempts. The three natural surface framings are `NO`; the two arbitrary background controls are `IRRELEVANT`; the genuinely ambiguous “真的是一道选择题吗” case is `BOTH`.

- [ ] **Step 4: Run extraction v3 five times per puzzle and review all ten outputs**

Run:

```powershell
pnpm benchmark:key-points:v3 -- --rounds 5
```

For every output, verify against these exact principles: the dismemberment fact stands alone; the room-distribution causal mechanism is not collapsed into KP2; mosquito KP2 retains both purpose and failed result because those form the one approved score-worthy relation; no surface restatement, mother reaction, or post-solution consequence is added merely to reach a quota.

- [ ] **Step 5: Apply only bounded pre-freeze corrections if needed**

Use these fixed diagnostic branches without case hardcoding:

1. Natural surface framings become `IRRELEVANT`: strengthen only “direct ordinary framing of a salient surface element.”
2. Random attributes become `NO`: strengthen only “central to the apparent anomaly” and “no arbitrary association.”
3. Independently rewardable facts are conjoined: strengthen the independent-discovery and partial-coverage tests.
4. One inseparable relation is fragmented: strengthen the meaningful-alone and independently-score-worthy limits.

After any correction, update the matching frozen prompt snapshot, rerun both prompt unit tests, repeat the targeted no-write preflight, and regenerate the extraction report. Do not insert the supplied question strings or puzzle entities into production prompts.

- [ ] **Step 6: Freeze semantics and commit the extraction regression artifacts**

Run:

```powershell
pnpm --filter @turtle-soup/judge-worker test
pnpm --filter @turtle-soup/judge-worker typecheck
pnpm --filter @turtle-soup/judge-worker build
git diff --check
```

Commit the runner, fixture, reviewed report, scripts, and any bounded prompt correction. From this commit onward, do not change v6/v3 during UI, challenge, or formal benchmark tasks.

---

### Task 5: Show current-game question count in player statistics

**Files:**
- Modify: `apps/web/src/components/game/player-stats-panel.tsx`
- Test: `apps/web/src/components/game/player-stats-panel.test.tsx`

**Interfaces:**
- Consumes: existing `PublicPlayerStats.questionCount` from the public game snapshot.
- Produces: a four-column statistics table; no prop, API, database, or scoring changes.

- [ ] **Step 1: Add failing table assertions**

Extend the existing `PlayerStatsPanel` test to assert the column order and both fixture values:

```tsx
const headers = screen.getAllByRole('columnheader').map((header) => header.textContent);
expect(headers).toEqual(['玩家', '分数', '本局提问数', '命中率']);
expect(rows[1].textContent).toContain('2');
expect(rows[2].textContent).toContain('0');
```

- [ ] **Step 2: Run the focused test and verify RED**

Run:

```powershell
pnpm --filter @turtle-soup/web test -- src/components/game/player-stats-panel.test.tsx
```

Expected: FAIL because the current table has only 玩家、分数、命中率 and does not render `questionCount`.

- [ ] **Step 3: Render the existing field in the requested position**

In `PlayerStatsPanel`, add the `本局提问数` header between `分数` and `命中率`, and render `{player.questionCount}` in the corresponding cell. Do not change `sortedStats` or derive the value from messages in the component.

- [ ] **Step 4: Run focused and Web verification**

Run:

```powershell
pnpm --filter @turtle-soup/web test -- src/components/game/player-stats-panel.test.tsx
pnpm --filter @turtle-soup/web typecheck
pnpm --filter @turtle-soup/web lint
```

Expected: all commands pass; the existing sorting and zero hit-rate dash behavior remain covered.

- [ ] **Step 5: Commit only the statistics change**

```powershell
git add -- apps/web/src/components/game/player-stats-panel.tsx apps/web/src/components/game/player-stats-panel.test.tsx
git diff --cached --name-only
git diff --cached --check
git commit -m "feat: show current game question count"
```

Expected staged files: exactly the statistics component and its test.

---

### Task 6: Support Ctrl+Enter for question submission

**Files:**
- Modify: `apps/web/src/components/game/message-composer.tsx`
- Test: `apps/web/src/components/game/message-composer.test.tsx`

**Interfaces:**
- Consumes: the existing textarea draft state and form `onSubmit(content: string)` contract.
- Produces: a local textarea keyboard handler; no API, database, or parent-component changes.

- [ ] **Step 1: Add failing keyboard shortcut coverage**

Import `fireEvent` in the existing test and add a test that types a question, dispatches `Ctrl+Enter`, and expects exactly one submission, an empty draft, and the visible hint:

```tsx
it('submits once with Ctrl+Enter and clears the draft', async () => {
  const user = userEvent.setup();
  const onSubmit = vi.fn();
  render(<MessageComposer onSubmit={onSubmit} />);

  const input = screen.getByLabelText('提出问题') as HTMLTextAreaElement;
  await user.type(input, '是不是有蚊子？');
  fireEvent.keyDown(input, { key: 'Enter', code: 'Enter', ctrlKey: true });

  expect(onSubmit).toHaveBeenCalledTimes(1);
  expect(onSubmit).toHaveBeenCalledWith('是不是有蚊子？');
  expect(input.value).toBe('');
  expect(screen.getByText('Ctrl+Enter 发送')).toBeTruthy();
});
```

- [ ] **Step 2: Run the focused test and verify RED**

Run:

```powershell
pnpm --filter @turtle-soup/web test -- src/components/game/message-composer.test.tsx
```

Expected: FAIL because the textarea has no Ctrl+Enter handler or shortcut hint.

- [ ] **Step 3: Add newline and IME regression coverage**

Add tests proving ordinary Enter inserts a newline without submitting, and Ctrl+Enter during IME composition does not submit:

```tsx
it('keeps ordinary Enter as a newline', async () => {
  const user = userEvent.setup();
  const onSubmit = vi.fn();
  render(<MessageComposer onSubmit={onSubmit} />);

  const input = screen.getByLabelText('提出问题') as HTMLTextAreaElement;
  await user.type(input, '第一行{enter}第二行');

  expect(onSubmit).not.toHaveBeenCalled();
  expect(input.value).toBe('第一行\n第二行');
});

it('does not submit Ctrl+Enter during IME composition', async () => {
  const user = userEvent.setup();
  const onSubmit = vi.fn();
  render(<MessageComposer onSubmit={onSubmit} />);

  const input = screen.getByLabelText('提出问题') as HTMLTextAreaElement;
  await user.type(input, '蚊子');
  fireEvent.keyDown(input, {
    key: 'Enter',
    code: 'Enter',
    ctrlKey: true,
    isComposing: true,
  });

  expect(onSubmit).not.toHaveBeenCalled();
  expect(input.value).toBe('蚊子');
});
```

- [ ] **Step 4: Implement the minimal local handler**

In `MessageComposer`, handle only `Ctrl+Enter` on the textarea. Call `event.preventDefault()` and `event.currentTarget.form?.requestSubmit()` so trimming, empty checks, disabled/submitting guards, draft clearing, and the existing callback remain owned by the form submit handler. Ignore `event.nativeEvent.isComposing`. Keep ordinary Enter unchanged. Add the visible text `Ctrl+Enter 发送` beside the existing `0/500` counter without adding new CSS.

- [ ] **Step 5: Run focused and Web verification**

Run:

```powershell
pnpm --filter @turtle-soup/web test -- src/components/game/message-composer.test.tsx
pnpm --filter @turtle-soup/web typecheck
pnpm --filter @turtle-soup/web lint
pnpm --filter @turtle-soup/web build
```

Expected: all commands pass; the existing button-submit and disabled-state behavior remains intact.

- [ ] **Step 6: Commit only the composer change**

```powershell
git add -- apps/web/src/components/game/message-composer.tsx apps/web/src/components/game/message-composer.test.tsx
git diff --cached --name-only
git diff --cached --check
git commit -m "feat: submit questions with ctrl enter"
```

Expected staged files: exactly the message composer and its test.

---

### Task 7: Simplify the player game chrome and add the verdict legend

**Files:**
- Modify: `apps/web/src/components/game/puzzle-panel.tsx`
- Create: `apps/web/src/components/game/puzzle-panel.test.tsx`
- Modify: `apps/web/src/components/game/message-feed.tsx`
- Modify: `apps/web/src/components/game/message-feed.test.tsx`
- Modify: `apps/web/src/components/game/game-header.tsx`
- Create: `apps/web/src/components/game/game-header.test.tsx`
- Modify: `apps/web/src/components/game/game-client.tsx`
- Modify: `apps/web/src/components/game/game-client.integration.test.tsx`
- Modify: `apps/web/src/app/globals.css` only for the legend/placeholder layout rules

**Interfaces:**
- Consumes: existing `PublicGameSnapshot`, `PublicMessage`, player, and realtime props.
- Produces: presentation-only copy and layout changes; no route, session, snapshot, scoring, or verdict mapping changes.

- [ ] **Step 1: Add failing copy and visibility assertions**

Add focused tests for each boundary:

```tsx
// puzzle-panel.test.tsx
render(<PuzzlePanel game={{ ...game, puzzleSurface: '一个汤面' }} />);
expect(screen.getByRole('heading', { name: '当前汤面' })).toBeTruthy();
expect(screen.queryByText('共享汤面')).toBeNull();
expect(screen.queryByRole('heading', { name: '汤面' })).toBeNull();
```

Extend `message-feed.test.tsx` to assert the legend and removed labels while retaining sequence ordering:

```tsx
expect(screen.getByText('✅ 是')).toBeTruthy();
expect(screen.getByText('❌ 不是')).toBeTruthy();
expect(screen.getByText('❓ 是也不是')).toBeTruthy();
expect(screen.getByText('👎 与此无关')).toBeTruthy();
expect(screen.queryByText('公共问题流')).toBeNull();
expect(screen.queryByText('大家正在问什么')).toBeNull();
expect(screen.queryByText('按服务器顺序')).toBeNull();
```

Create `game-header.test.tsx` and assert `在线多人AI海龟汤游戏` is rendered and `管理入口` is absent. Extend the `GameClient` integration coverage to assert `当前玩家` is absent and a `当前进度` placeholder is present. Update the existing public-label assertion from `汤面` to `当前汤面`.

- [ ] **Step 2: Run the focused tests and verify RED**

Run:

```powershell
pnpm --filter @turtle-soup/web test -- src/components/game/puzzle-panel.test.tsx src/components/game/message-feed.test.tsx src/components/game/game-header.test.tsx src/components/game/game-client.integration.test.tsx
```

Expected: FAIL because the current copy still exposes the removed headings/link, the puzzle title is `汤面`, and the sidebar still renders `当前玩家`.

- [ ] **Step 3: Implement the presentation-only changes**

1. In `PuzzlePanel`, remove the “共享汤面” eyebrow and change the heading to “当前汤面”.
2. In `MessageFeed`, replace the section heading block with a visible legend using the existing `reactionForVerdict` mapping: `✅ 是`, `❌ 不是`, `❓ 是也不是`, `👎 与此无关`. Keep the message list sorted by `sequenceNo`; use an accessible section label without reintroducing the removed visible copy.
3. In `GameHeader`, change “海龟汤 / 单局现场” to “在线多人AI海龟汤游戏” and remove only the public `/admin` link. Do not remove the route or alter admin authentication.
4. In `GameClient`, replace the `当前玩家` sidebar section with a non-functional `当前进度` placeholder. Keep `activePlayer` available for the header’s existing “你是 …” context and for message ownership; do not remove player identity from the data flow.
5. Add the smallest responsive styles for the legend and placeholder, reusing existing panel styles and avoiding unrelated visual redesign.

- [ ] **Step 4: Run full Web verification**

Run:

```powershell
pnpm --filter @turtle-soup/web test
pnpm --filter @turtle-soup/web typecheck
pnpm --filter @turtle-soup/web lint
pnpm --filter @turtle-soup/web build
```

Expected: all tests and checks pass; message ownership, reaction attachment, private final-answer behavior, and existing player statistics remain unchanged.

- [ ] **Step 5: Commit only the player-chrome changes**

```powershell
git add -- apps/web/src/components/game/puzzle-panel.tsx apps/web/src/components/game/puzzle-panel.test.tsx apps/web/src/components/game/message-feed.tsx apps/web/src/components/game/message-feed.test.tsx apps/web/src/components/game/game-header.tsx apps/web/src/components/game/game-header.test.tsx apps/web/src/components/game/game-client.tsx apps/web/src/components/game/game-client.integration.test.tsx apps/web/src/app/globals.css
git diff --cached --name-only
git diff --cached --check
git commit -m "feat: simplify player game chrome"
```

Expected staged files: exactly the listed player-facing components, tests, and scoped styles.

---

### Task 8: Add the deterministic five-judgment challenge aggregator

**Files:**
- Modify: `packages/contracts/src/judge.ts`
- Modify: `packages/contracts/src/index.ts`
- Create: `packages/game-core/src/challenge.ts`
- Modify: `packages/game-core/src/index.ts`
- Create: `packages/game-core/src/challenge.test.ts`

**Interfaces:**
- Consumes: five valid judgments, ordered as original judgment first followed by four fresh judgments, plus the active game key-point ID set.
- Produces: `{ finalVerdict, fullyCoveredKeyPointIds }` without database or model dependencies.

- [ ] **Step 1: Define the typed challenge result and write failing aggregation tests**

Add types for one validated judgment and one resolved result. Cover these exact cases:

```ts
// four YES and one NO -> YES
// no verdict reaches four, IRRELEVANT appears twice -> IRRELEVANT
// otherwise -> BOTH
// a key point is included only when it appears in at least four of five coverage sets
// fewer than five valid judgments or an unknown key-point ID -> throw
```

Also test that duplicate IDs within one judgment are rejected before counting.

- [ ] **Step 2: Run the focused test and verify RED**

Run:

```powershell
pnpm --filter @turtle-soup/game-core test -- src/challenge.test.ts
```

Expected: FAIL because the challenge types and resolver do not yet exist.

- [ ] **Step 3: Implement the pure resolver**

Implement `resolveChallengeJudgments(judgments, validKeyPointIds)` with the exact order:

```text
require exactly five valid judgments
count each verdict
if any verdict count >= 4: use that verdict
else if IRRELEVANT count >= 2: use IRRELEVANT
else: use BOTH
for each key point: include it when coverage count >= 4
```

Do not call the model, inspect database state, or mutate inputs in this function.

- [ ] **Step 4: Run package verification**

Run:

```powershell
pnpm --filter @turtle-soup/game-core test
pnpm --filter @turtle-soup/game-core typecheck
```

Expected: all existing game-rule tests and the new challenge aggregation tests pass.

---

### Task 9: Persist challenge state, repair audit compatibility, and enqueue a review safely

**Files:**
- Create: `supabase/migrations/20260815163829_message_challenges.sql`
- Create: `supabase/migrations/20260815165150_message_challenge_permissions.sql`
- Create: `supabase/migrations/20260815165749_narrow_challenge_message_update.sql`
- Modify: `supabase/tests/database/001_schema.test.sql`
- Modify: `supabase/tests/database/002_security.test.sql`
- Modify: `supabase/tests/database/004_queue.test.sql`
- Modify: `packages/contracts/src/game.ts`
- Modify: `apps/web/src/server/game/get-current-snapshot.ts`
- Modify: `apps/web/src/server/game/submit-message.ts`
- Create: `apps/web/src/server/game/submit-challenge.ts`
- Create: `apps/web/src/app/api/game/current/messages/challenge/route.ts`
- Create: `apps/web/src/server/game/submit-challenge.test.ts`
- Create: `apps/web/src/app/api/game/current/messages/challenge/route.test.ts`
- Modify: `apps/web/src/server/http/responses.ts`

**Interfaces:**
- Consumes: an authenticated player session, a current-game message ID, and an idempotency key.
- Produces: a public `challengeStatus` (`NONE`, `PENDING`, `RESOLVED`, or `FAILED`) and a private `CHALLENGE` queue action; no public judgment array.

- [ ] **Step 1: Add the migration and database contract tests**

Extend `private.action_type` with `CHALLENGE`, add a public `api.message_challenge_status` enum and `api.messages.challenge_status` defaulting to `NONE`, and create:

1. `private.question_judgments`: one row per judged message containing the immutable original valid judgment and the current reconciled verdict/complete covered-key-point UUID array.
2. `private.message_challenges`: one MVP challenge per message, linking the target message, challenger, queue action, status, valid-judgment count, and final resolution fields.
3. `private.challenge_judgments`: four fresh attempts at slots 1–4, with nullable verdict/covered IDs for invalid responses, validity, and provider/model/reasoning/prompt/schema/latency/token metadata. The immutable original judgment remains in `private.question_judgments` and is combined with the four fresh rows for resolution.

`private.question_judgments` must retain both the immutable original result and the current reconciled result (`original_*` and `current_*` coverage/verdict fields), `prompt_version`, and a completeness flag. Do not backfill hidden coverage by inference. The challenge service must require every judged message involved in claim reconstruction to have a complete record with `prompt_version = 'question-judge-v6'`; otherwise it rejects that challenge safely.

The same migration must replace the current `judge_attempts_reasoning_effort_check`, which incorrectly allows only `off/high/max`, with the exact production enum `off, none, low, medium, high, max`. Add a database test proving a Luna `medium` audit row is accepted and an unknown effort is rejected. This repairs the current silent audit loss before challenge calls are introduced.

Add the required foreign keys, uniqueness constraints, key-point ID checks, grants/RLS, and indexes. Keep all judgment arrays in `private`; only `api.messages.challenge_status` is public.

- [ ] **Step 2: Persist every original valid Question Judge result**

Update `completeQuestion` so its existing transaction inserts or upserts the validated original result into `private.question_judgments` before marking the normal action complete. Existing message verdict, first-hit claim, and score behavior must remain unchanged.

- [ ] **Step 3: Implement the challenge submission service**

Implement `submitChallenge({ playerId, messageId, idempotencyKey, payloadDigest })` in one web transaction. It must:

1. require a fresh worker heartbeat and an authenticated player;
2. lock the current active game and target message;
3. require the target message to be `JUDGED`, have an original private v6 judgment, have `challenge_status = NONE`, and require complete v6 private judgment rows for all judged messages whose coverage may affect first-hit reconstruction;
4. allocate a new queue sequence/action and challenge ID idempotently;
5. copy the original valid judgment into challenge ordinal 1;
6. leave the public message `status = JUDGED`, verdict, reaction, and award unchanged; set only `api.messages.challenge_status` and the private challenge to `PENDING`;
7. return only `{ challengeId, status: 'PENDING' }`.

Repeated idempotent requests replay the same receipt; a second distinct challenge for the same message returns a safe conflict. Do not increment question count or score when a challenge is submitted.

- [ ] **Step 4: Add the authenticated API route and route tests**

Add `POST /api/game/current/messages/challenge` with same-origin, player-session, idempotency, input validation, and safe error mapping. The target message ID is a validated JSON body field. Verify that no private verdict, coverage IDs, model output, or challenger-only metadata appears in the response.

- [ ] **Step 5: Update the public snapshot projection**

Select `messages.challenge_status` as `challengeStatus` in both open and ended snapshot queries and add the field to `PublicMessage`. Use `NONE` for demo fixtures and preserve all existing message fields.

- [ ] **Step 6: Run Web and database-contract verification**

Run:

```powershell
pnpm exec supabase db push --local
pnpm exec supabase test db
pnpm --filter @turtle-soup/web test -- src/server/game/submit-challenge.test.ts src/app/api/game/current/messages/challenge/route.test.ts
pnpm --filter @turtle-soup/web typecheck
pnpm --filter @turtle-soup/web lint
```

Expected: the forward migration applies without resetting local data; Luna `medium` audit rows are accepted; the challenge receipt is idempotent; only complete v6 judgments are eligible; public snapshots contain status but no hidden judgment data.

---

### Task 10: Run four independent fresh judgments and reconcile atomically

**Files:**
- Create: `services/judge-worker/src/processors/challenge-processor.ts`
- Create: `services/judge-worker/src/processors/challenge-processor.test.ts`
- Create: `services/judge-worker/src/db/complete-challenge.ts`
- Create: `services/judge-worker/src/db/complete-challenge.test.ts`
- Modify: `services/judge-worker/src/db/queue.ts`
- Modify: `services/judge-worker/src/processors/action-processor.ts`
- Modify: `services/judge-worker/src/main.ts`
- Modify: `services/judge-worker/src/db/complete-question.ts`
- Modify: `services/judge-worker/src/db/judge-attempts.ts`

**Interfaces:**
- Consumes: a leased `CHALLENGE` action, the target message’s canonical puzzle input and fixed key points, the persisted ordinal-1 original judgment, and the configured Question Judge.
- Produces: one resolved challenge transaction that changes only authoritative derived state and marks the challenge `RESOLVED`.

- [ ] **Step 1: Add failing worker tests for independent fresh calls**

Test that the processor:

1. sends the same canonical input and current message to four separate Question Judge calls;
2. does not include prior judgments, chat history, scores, or discovered-key-point state in those calls;
3. stores schema-valid results in fresh slots 1–4 and records invalid attempts separately without a verdict;
4. does not count invalid outputs toward the required five;
5. resumes missing slots after a retry without replacing the original judgment.

- [ ] **Step 2: Run the focused worker tests and verify RED**

Run:

```powershell
pnpm --filter @turtle-soup/judge-worker test -- src/processors/challenge-processor.test.ts src/db/complete-challenge.test.ts
```

Expected: FAIL because `CHALLENGE` is not yet claimable/processable and no atomic completion path exists.

- [ ] **Step 3: Extend queue dispatch for `CHALLENGE`**

Update the claimed-action type and processor dispatch so `CHALLENGE` is handled by `processChallenge`; normal messages and final answers keep their existing paths and retry semantics.

- [ ] **Step 4: Implement the fresh-judgment processor**

Load the canonical surface, full solution, fixed key points, message content, and original v6 judgment from private storage. For each missing slot 1–4, call the existing configured Question Judge independently with the frozen production v6 prompt and validate the structured result. Create one audited wrapper per fresh slot so audit `attempt_no` is exactly 1–4 for the four calls rather than reusing the queue retry number. Invalid results are recorded as invalid attempts and do not advance `valid_judgment_count`; bounded retries resume only missing valid slots and eventually mark the challenge failed instead of resolving it with fewer than five valid judgments.

- [ ] **Step 5: Implement the atomic reconciliation transaction**

Once five valid judgments exist, call `resolveChallengeJudgments`. In one database transaction that locks the game, target message, challenge, all judged messages in the game, and affected player rows:

1. update the target message verdict and the target row’s current private covered-key-point result;
2. rebuild first-hit key-point claims in message sequence order from every complete persisted current coverage set;
3. recalculate each message’s awarded points from those first-hit claims;
4. apply only the per-player lifetime-score delta from old awards to new awards;
5. recalculate `api.games.discovered_key_point_count`;
6. recalculate each affected `api.game_player_stats.yes_count` while leaving `question_count` unchanged;
7. update the public message challenge status and private challenge to `RESOLVED`.

The transaction must commit all of these changes together or none of them. It must never reveal the five judgments or private coverage arrays. If fewer than five valid judgments are available, it must not modify the displayed verdict, claims, score, or hit-rate.

- [ ] **Step 6: Verify worker behavior and audit metadata**

Run:

```powershell
pnpm --filter @turtle-soup/judge-worker test
pnpm --filter @turtle-soup/judge-worker typecheck
pnpm --filter @turtle-soup/judge-worker build
```

Expected: five-valid-judgment enforcement, exact verdict/coverage thresholds, first-hit ownership preservation, atomic score/stat reconciliation, and model-call audit rows all pass.

---

### Task 11: Wire the challenge button to the public message stream

**Files:**
- Modify: `apps/web/src/lib/game-api.ts`
- Modify: `apps/web/src/components/game/message-row.tsx`
- Modify: `apps/web/src/components/game/message-feed.tsx`
- Modify: `apps/web/src/components/game/game-client.tsx`
- Modify: `apps/web/src/components/game/message-row.test.tsx`
- Modify: `apps/web/src/components/game/message-feed.test.tsx`
- Modify: `apps/web/src/components/game/game-client.integration.test.tsx`
- Modify: `apps/web/src/lib/demo-snapshot.ts`

**Interfaces:**
- Consumes: `PublicMessage.challengeStatus` and the challenge API receipt.
- Produces: a player-visible challenge action attached to the same message bubble; no AI chat bubble and no private result disclosure.

- [ ] **Step 1: Add failing UI tests**

Cover that:

1. a judged message with `challengeStatus = NONE` shows an enabled “质疑” button;
2. clicking it calls the challenge route with the target message ID and an idempotency key;
3. the same bubble shows a pending/disabled challenge state while preserving the original verdict reaction until atomic resolution;
4. a resolved challenge shows a non-repeatable “已质疑” state while the reaction remains beside the original message;
5. an exhausted challenge shows a disabled “质疑失败” state, keeps the original authoritative verdict unchanged, and exposes no model details.

- [ ] **Step 2: Run focused UI tests and verify RED**

Run:

```powershell
pnpm --filter @turtle-soup/web test -- src/components/game/message-row.test.tsx src/components/game/message-feed.test.tsx src/components/game/game-client.integration.test.tsx
```

Expected: FAIL because `GameClient` currently does not pass `onChallenge`, the API adapter is absent, and messages have no challenge status.

- [ ] **Step 3: Implement the smallest UI/API wiring**

Add `postChallenge(messageId)` to the existing game API helper, pass an `onChallenge` callback from `GameClient` through `MessageFeed` to `MessageRow`, and keep the challenge control visually attached to the same player message. Use optimistic local `PENDING` status only; final verdict/reaction, score, and statistics continue to arrive from the authoritative realtime snapshot.

- [ ] **Step 4: Run end-to-end local verification**

With local Supabase and the Judge Worker running, create a fresh active game, submit one question, wait for its original judgment, click “质疑”, and verify:

```text
original judgment -> four independent fresh calls -> five valid results
-> one atomic displayed verdict/coverage/score/stat update
-> challenge status RESOLVED
```

Verify that no AI-authored message or private judgment payload appears in the public stream.

- [ ] **Step 5: Commit the challenge feature in scoped commits**

Use separate commits for the pure aggregator, persistence/API, worker reconciliation, and UI wiring. Before each commit, stage only the files listed in that task and run `git diff --cached --check`.

---

### Task 12: Verify the complete stage, freeze the commit, and run the final 300-attempt benchmark

**Files:**
- Verify: all files changed by Tasks 1–11
- Create: `docs/reports/2026-08-16-all-choices-correct-question-judge-v6-30case-2config-5round.md`
- Create: `docs/reports/2026-08-16-all-choices-correct-question-judge-v6-30case-2config-5round.results.json`
- Create only when browser tooling needs artifacts: `E:\CodexTemp\projects\turtle-soup\browser-check\*`

**Interfaces:**
- Consumes: the completed v6/v3 implementation, migrated local database, running web/worker stack, supplied fixed 30-case gold, and existing `.env.local` secrets.
- Produces: one frozen formal benchmark with exactly 300 attempts, a verified local UI/game flow, and a concise final report to the user. It does not retune prompts after seeing formal results.

- [ ] **Step 1: Run the complete deterministic verification matrix**

Run from the repository root:

```powershell
pnpm test
pnpm typecheck
pnpm --filter @turtle-soup/web lint
pnpm build
pnpm exec supabase test db --db-url <isolated-test-db-url>
```

Expected: every listed command exits 0. The repository-wide `pnpm lint` remains a pre-existing baseline diagnostic because the contracts/game-core packages have no ESLint file-matching configuration; do not broaden this UI/challenge task to redesign that lint setup. Run database tests against a disposable database clone, never by resetting the user’s active local database. Fix failures within the owning task’s scope and rerun the failed focused test before repeating this matrix. Do not weaken tests or alter gold to obtain a pass.

- [ ] **Step 2: Exercise the challenge transaction without risking existing local data**

Run the challenge aggregator, API, worker, and database integration tests together:

```powershell
pnpm --filter @turtle-soup/game-core test -- src/challenge.test.ts
pnpm --filter @turtle-soup/web test -- src/server/game/submit-challenge.test.ts src/app/api/game/current/messages/challenge/route.test.ts src/components/game/message-row.test.tsx src/components/game/game-client.integration.test.tsx
pnpm --filter @turtle-soup/judge-worker test -- src/processors/challenge-processor.test.ts src/db/complete-challenge.test.ts src/db/complete-question.test.ts
pnpm exec supabase test db --db-url <isolated-test-db-url>
```

Do not run `supabase db reset` against the user’s current local database. The tests must prove the exact five-valid-vote thresholds, v6 eligibility, atomic rollback on failure, claim reassignment, score delta, unchanged `question_count`, recomputed `yes_count`, and no public private-data leak.

- [ ] **Step 3: Run a local browser verification of the requested UI**

Start or reuse the local web and worker processes without printing environment secrets. In a browser at `http://localhost:3000/`, verify:

```text
header: 在线多人AI海龟汤游戏
puzzle title: 当前汤面
not visible: 共享汤面 / 公共问题流 / 大家正在问什么 / 按服务器顺序 / 当前玩家 / 管理入口
legend: ✅ 是 / ❌ 不是 / ❓ 是也不是 / 👎 与此无关
stats columns: 玩家 / 分数 / 本局提问数 / 命中率
Ctrl+Enter: sends once
Enter: inserts newline
message bubbles: own right, others left, verdict attached to same message
sidebar: 当前进度 placeholder
challenge: only judged v6 message starts pending; terminal state disables repeat
```

Navigate directly to `http://localhost:3000/admin` and verify the admin route still works and key points remain admin-only/read-only. Store any generated screenshot or browser profile only below `E:\CodexTemp\projects\turtle-soup\browser-check`, never in a drive root or repository.

- [ ] **Step 4: Commit all verified implementation before freezing benchmark metadata**

Inspect the worktree and preserve the user-owned untracked files:

```powershell
git status --short
git diff --check
git diff --cached --name-only
```

Commit any remaining scoped implementation, tests, migration, plan, and extraction-preflight report. Do not stage `apps/web/AGENTS.md`, `apps/web/CLAUDE.md`, `apps/web/tsconfig.tsbuildinfo`, `.env.local`, or browser/temp artifacts.

- [ ] **Step 5: Run an API connectivity preflight before the formal experiment**

Run one no-write attempt per configuration on one ordinary case:

```powershell
pnpm benchmark:all-choices:30 -- --rounds 1 --cases "school_exam" --no-write
```

Expected: exactly two schema-valid results. If the endpoint is temporarily unavailable, retry this preflight with bounded backoff; do not start or partially overwrite the formal report until it passes.

- [ ] **Step 6: Freeze the exact commit and run the requested formal benchmark once**

Set the frozen hash from the verified implementation commit and run all 300 attempts:

```powershell
$benchmarkFrozenCommit = (git rev-parse HEAD).Trim()
if ($benchmarkFrozenCommit -notmatch '^[0-9a-f]{40}$') { throw 'invalid frozen commit' }
$env:BENCHMARK_FROZEN_COMMIT = $benchmarkFrozenCommit
pnpm benchmark:all-choices:30 -- --rounds 5
```

The runner must use exactly:

```text
GPT-5.6 Luna / none   : 30 cases × 5 rounds = 150 attempts
GPT-5.6 Luna / medium : 30 cases × 5 rounds = 150 attempts
Total                 : 300 attempts
```

Do not include DeepSeek or any other model. Do not selectively retry failed semantic rows. Transport/schema failures remain part of the measured valid rate.

- [ ] **Step 7: Validate artifacts and interpret failures without changing policy**

Verify the results JSON contains 300 rows, both configurations exactly 150 times, `promptVersion = question-judge-v6`, `rounds = 5`, the supplied fixture path, and the frozen 40-character commit. Verify the Markdown includes every required metric and per-case stability.

Classify remaining failures into at least:

```text
surface interpretation
NO vs IRRELEVANT
ordinary ambiguity / BOTH
KP over-trigger
KP under-trigger
wrong KP ID / multi-KP
schema or transport reliability
```

Interpret whether a failure is consistent across both reasoning settings, concentrated in Luna none, or stochastic across rounds. Do not modify v6, v3, or gold after the formal run; recommend a separate v7 experiment if policy changes are justified.

- [ ] **Step 8: Commit immutable benchmark artifacts and report completion**

Run:

```powershell
git add -- docs/reports/2026-08-16-all-choices-correct-question-judge-v6-30case-2config-5round.md docs/reports/2026-08-16-all-choices-correct-question-judge-v6-30case-2config-5round.results.json
git diff --cached --name-only
git diff --cached --check
git commit -m "docs: record question judge v6 benchmark"
```

The handoff report must state the final extracted KPs for both fixtures, all implementation checks run, verdict/KP/joint/valid metrics for both Luna configurations, latency/token data, any challenge/UI caveat actually observed, and whether remaining semantic errors look policy-related or model-capability-related.

---

## Plan Maintenance

This plan is frozen for unattended execution after the user approves it. New product ideas are not folded into the active run; they are recorded for a later plan so v6/v3 prompts, database reconciliation, UI verification, and the final benchmark remain reproducible.
