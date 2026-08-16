# Key Point Extraction v4 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Publish `key-point-extraction-v4` with a coherent milestone-selection procedure that prevents both unnecessary conjunctive key points and mechanical splitting of automatic consequences.

**Architecture:** Keep the existing `buildKeyPointExtractionPrompt` function, input contract, and JSON schema. Replace only the overlapping v3 selection rules with the approved v4 procedure, freeze the exact production policy in a new snapshot, and preserve the v3 snapshot unchanged for historical comparison.

**Tech Stack:** TypeScript, Vitest, pnpm workspace, strict JSON Schema prompt output.

## Global Constraints

- Source specification: `docs/superpowers/specs/2026-08-16-key-point-extraction-v4-design.md`.
- Preserve `services/judge-worker/src/skills/prompts/key-point-extraction-v3.txt` byte-for-byte.
- Production version must be exactly `key-point-extraction-v4`.
- The extractor still receives only `puzzle_surface` and `full_solution`.
- The result schema remains exactly 3–5 `{ content: string }` key points.
- An already-disclosed outcome cannot become a standalone key point merely by being repeated, but may appear inside a larger hidden causal mechanism.
- A later point is independent only when it introduces genuinely new hidden information, not when it merely narrates an automatic next consequence.
- Final ordering follows the player's logical reconstruction path, normally using chronology when meaningful.
- Do not add puzzle-specific production examples, benchmark fixtures, model routing changes, UI changes, database changes, or a live model run.
- Preserve unrelated untracked files under `apps/web/`.

---

### Task 1: Define the v4 prompt contract with failing tests

**Files:**
- Modify: `services/judge-worker/src/skills/key-point-extraction.test.ts`
- Read only: `services/judge-worker/src/skills/key-point-extraction.ts`
- Preserve: `services/judge-worker/src/skills/prompts/key-point-extraction-v3.txt`

**Interfaces:**
- Consumes: `buildKeyPointExtractionPrompt(input: KeyPointExtractionInput): string` and `KEY_POINT_EXTRACTION_PROMPT_VERSION`.
- Produces: a failing behavioral contract for the v4 version, exact policy wording, frozen v4 snapshot, and unchanged result schema.

- [ ] **Step 1: Update the version and policy assertions before production code**

Change the first prompt-policy test so it requires v4 and the approved selection rules:

```ts
expect(KEY_POINT_EXTRACTION_PROMPT_VERSION).toBe('key-point-extraction-v4');
expect(prompt).toContain('SELECTION PROCEDURE');
expect(prompt).toContain('Silently reconstruct the complete causal story');
expect(prompt).toContain('atomic hidden facts, states, identities, relationships, actions, and causal mechanisms');
expect(prompt).toContain('meaningful reasoning milestones');
expect(prompt).toContain('SINGLE-QUESTION TEST');
expect(prompt).toContain('PARTIAL COVERAGE SANITY TEST');
expect(prompt).toContain('LOGICAL INDEPENDENCE TEST');
expect(prompt).toContain('CHAIN COMPLETENESS TEST');
expect(prompt).toContain('Do not create a separate key point merely for an outcome already disclosed by the surface');
expect(prompt).toContain('an already-known outcome may be included inside a larger hidden mechanism');
expect(prompt).toContain('A later point is independent only if it introduces a genuinely new hidden fact, state, relationship, action, or mechanism');
expect(prompt).toContain('Merely narrating the obvious next consequence of an earlier point does not create a new milestone');
expect(prompt).toContain('Do not compress to three when four or five are genuinely needed');
expect(prompt).toContain("Order the final points by the player's logical reconstruction path");
expect(prompt).toContain('normally following story chronology when that is meaningful');
expect(prompt).not.toContain('If three sufficient points reconstruct the solution, return exactly three');
expect(prompt).not.toContain('ordered by story chronology');
```

Retain the existing assertions for 3–5 points, `full_solution` support, surface-restatement exclusion, unsupported-detail exclusion, untrusted-data handling, excluded conversation state, and unchanged schema.

- [ ] **Step 2: Keep the production policy generic**

Retain negative assertions against the known puzzle strings and extend them to the additional follow-up examples so none can leak into production:

```ts
expect(prompt).not.toContain('蚊子');
expect(prompt).not.toContain('选择题');
expect(prompt).not.toContain('蜜蜂');
expect(prompt).not.toContain('回旋镖');
expect(prompt).not.toContain('医学院');
```

- [ ] **Step 3: Point the snapshot test at the not-yet-created v4 file**

Rename the snapshot test to `matches the frozen v4 policy snapshot before runtime data` and change only its snapshot URL:

```ts
const snapshot = readFileSync(new URL('./prompts/key-point-extraction-v4.txt', import.meta.url), 'utf8');
```

- [ ] **Step 4: Run the focused test and verify RED**

Run:

```powershell
pnpm --filter @turtle-soup/judge-worker test -- src/skills/key-point-extraction.test.ts
```

Expected: FAIL because production still reports v3, the v4 selection rules are absent, and `key-point-extraction-v4.txt` does not exist. The failure must be semantic/missing-file evidence for v4, not a TypeScript or import error.

---

### Task 2: Implement and freeze the minimal v4 production policy

**Files:**
- Modify: `services/judge-worker/src/skills/key-point-extraction.ts`
- Create: `services/judge-worker/src/skills/prompts/key-point-extraction-v4.txt`
- Test: `services/judge-worker/src/skills/key-point-extraction.test.ts`
- Preserve: `services/judge-worker/src/skills/prompts/key-point-extraction-v3.txt`

**Interfaces:**
- Consumes: the failing v4 contract from Task 1 and the unchanged `KeyPointExtractionInput`.
- Produces: `KEY_POINT_EXTRACTION_PROMPT_VERSION = 'key-point-extraction-v4'` and the unchanged prompt return type `string`.

- [ ] **Step 1: Change the published version**

Set:

```ts
export const KEY_POINT_EXTRACTION_PROMPT_VERSION = 'key-point-extraction-v4';
```

- [ ] **Step 2: Replace only the overlapping v3 decision rules**

Keep the role, untrusted-data boundary, `full_solution` support, no-invention guard, concision guard, and JSON-only output. Remove the v3 absolute chronology sentence, exact-three preference, and the selection block beginning with `First silently decompose full_solution`.

Also remove the absolute v3 sentence `Do not restate an explicit outcome or its immediate consequence.` because the approved standalone-outcome rule and hidden-mechanism exception below replace it.

Insert these exact policy lines before the final concision/output rules:

```ts
'SELECTION PROCEDURE',
'1. Silently reconstruct the complete causal story.',
'2. Decompose the solution into atomic hidden facts, states, identities, relationships, actions, and causal mechanisms.',
'3. Remove standalone restatements of facts already disclosed by the surface, weak background details, redundant consequences, and facts that do not materially advance reconstruction.',
'Do not create a separate key point merely for an outcome already disclosed by the surface or for an immediate consequence that adds no new hidden information.',
'However, an already-known outcome may be included inside a larger hidden mechanism when it is needed to express that milestone naturally and complete the causal chain.',
'4. Identify the meaningful reasoning milestones a real player would need to discover.',
'5. Apply the SINGLE-QUESTION TEST: each milestone should normally be discoverable through one natural, focused question.',
'6. Apply the PARTIAL COVERAGE SANITY TEST: do not bind independently rewardable discoveries into one key point.',
'7. Apply the LOGICAL INDEPENDENCE TEST: do not create separate milestones for facts that become obvious or automatic once another selected point is known.',
'A later point is independent only if it introduces a genuinely new hidden fact, state, relationship, action, or mechanism.',
'Ask: does the later point introduce new hidden information, or merely narrate what would naturally happen next?',
'Merely narrating the obvious next consequence of an earlier point does not create a new milestone.',
'8. Apply the CHAIN COMPLETENESS TEST: the selected milestones together should reconstruct the main hidden logic from the surface setup to the mechanism that resolves the puzzle.',
'9. Choose 3–5 points according to the actual number of meaningful milestones. Do not compress to three when four or five are genuinely needed, and do not split weakly just to increase the count.',
"10. Order the final points by the player's logical reconstruction path, normally following story chronology when that is meaningful.",
```

Keep `Do not restate facts already disclosed by puzzle_surface merely to fill the quota.` because it blocks standalone restatement; the explicit mechanism exception above defines the allowed non-standalone use of an already-known outcome.

- [ ] **Step 3: Freeze the exact v4 policy prefix**

Create `services/judge-worker/src/skills/prompts/key-point-extraction-v4.txt` containing the exact prompt prefix produced by `buildKeyPointExtractionPrompt`, from `You are a strict Turtle Soup key-point extractor.` through `Return exactly one JSON object with key_points and no explanation.`, followed by one newline. Do not include `UNTRUSTED_DATA:` or runtime JSON.

- [ ] **Step 4: Run the focused test and verify GREEN**

Run:

```powershell
pnpm --filter @turtle-soup/judge-worker test -- src/skills/key-point-extraction.test.ts
```

Expected: all extraction prompt tests pass, including the byte-for-byte v4 snapshot and unchanged 3–5 schema assertions.

- [ ] **Step 5: Prove v3 was not modified**

Run:

```powershell
git diff --exit-code -- services/judge-worker/src/skills/prompts/key-point-extraction-v3.txt
```

Expected: exit code 0 with no diff.

---

### Task 3: Verify, review scope, and commit v4

**Files:**
- Verify: `services/judge-worker/src/skills/key-point-extraction.ts`
- Verify: `services/judge-worker/src/skills/key-point-extraction.test.ts`
- Verify: `services/judge-worker/src/skills/prompts/key-point-extraction-v4.txt`
- Preserve: all unrelated workspace files.

**Interfaces:**
- Consumes: the v4 prompt implementation from Task 2.
- Produces: a verified, scoped commit containing only v4 production policy, tests, frozen prompt, and this implementation plan.

- [ ] **Step 1: Run focused prompt and schema validation**

Run:

```powershell
pnpm --filter @turtle-soup/judge-worker test -- src/skills/key-point-extraction.test.ts src/skills/validate-result.test.ts
```

Expected: both test files pass.

- [ ] **Step 2: Run the complete worker verification**

Run:

```powershell
pnpm --filter @turtle-soup/judge-worker test
pnpm --filter @turtle-soup/judge-worker typecheck
```

Expected: the full worker test suite and TypeScript validation exit 0.

- [ ] **Step 3: Review the exact scope**

Run:

```powershell
git diff --check
git status --short
git diff -- services/judge-worker/src/skills/key-point-extraction.ts services/judge-worker/src/skills/key-point-extraction.test.ts services/judge-worker/src/skills/prompts/key-point-extraction-v4.txt docs/superpowers/plans/2026-08-16-key-point-extraction-v4.md
```

Expected: no whitespace errors; no v3 prompt diff; no Question Judge, model-routing, benchmark, UI, or database changes. Existing untracked files under `apps/web/` remain untouched.

- [ ] **Step 4: Commit only the approved files**

Run:

```powershell
git add -- services/judge-worker/src/skills/key-point-extraction.ts services/judge-worker/src/skills/key-point-extraction.test.ts services/judge-worker/src/skills/prompts/key-point-extraction-v4.txt docs/superpowers/plans/2026-08-16-key-point-extraction-v4.md
git diff --cached --name-only
git diff --cached --check
git commit -m "feat: add key point extraction v4 policy"
```

Expected staged paths are exactly the four files listed above. The previously committed design specification is not amended in this implementation commit.
