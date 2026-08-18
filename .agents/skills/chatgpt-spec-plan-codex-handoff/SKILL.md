---
name: chatgpt-spec-plan-codex-handoff
description: Use when a feature or change should be designed in ChatGPT web, saved as approved spec and implementation plan in a GitHub repository, then handed off to Codex for implementation.
---

# ChatGPT Spec → Plan → Codex Handoff

## Overview

Use ChatGPT web for product/repo analysis and planning, persist the result in GitHub, then give Codex a short execution prompt. The GitHub documents are the source of truth; the handoff prompt must not duplicate them.

## Required workflow

1. **Inspect the real repository first.** Use the GitHub connector to confirm repository, branch/HEAD, applicable `AGENTS.md`/`CLAUDE.md`, relevant files, tests, and recent code changes.
2. **Design before writing.** Use the appropriate brainstorming depth. Do not modify repository files until the user has approved the design/scope.
3. **Write the approved Spec and Plan directly to GitHub.** Prefer:
   - `docs/superpowers/specs/YYYY-MM-DD-<feature>-design.md`
   - `docs/superpowers/plans/YYYY-MM-DD-<feature>.md`
   Record the **code baseline SHA** separately from later documentation-only commits.
4. **Verify the remote artifacts.** Fetch both files after writing and record the resulting remote branch HEAD. Never assume a Codex local checkout has received these commits.
5. **Generate one short, path-filled Codex prompt.** It must include the repository, remote docs HEAD, exact Spec/Plan paths, and a compact sync instruction. It must tell Codex to read the files and execute rather than re-plan.

## Codex handoff format

```text
Repository: <owner/repo>
Remote docs HEAD: <sha>

先 git fetch origin --prune，并确认 origin/main 包含上述 commit 或其后继提交；工作树干净时同步到最新 main。

Spec:
<exact spec path>

Plan:
<exact plan path>

需求分析、设计和 implementation planning 已完成。
请直接读取 Spec + Plan，按 Plan 的 Task/TDD 顺序执行；不要重新 brainstorming 或生成新 spec/plan。遵守仓库 AGENTS.md，不扩大 scope，完成 Plan 中全部 verification/acceptance，最后汇报实际修改、验证结果和任何偏差。
```

Keep this prompt short. Product rules, file maps, test cases, architecture, and acceptance details belong in Spec/Plan, not in the outer prompt.

## Failure prevention

- **Remote ≠ local:** `origin/main` can be stale until `git fetch`; always include the sync step and remote docs HEAD.
- **No duplicated requirements:** never paste the Spec/Plan back into the Codex prompt.
- **No guessed repo state:** verify paths and HEAD after GitHub writes.
- **No premature implementation:** ChatGPT writes planning docs unless the user explicitly asks it to implement code too.

## Completion gate

Before reporting handoff readiness, verify that both remote files exist at the stated paths and that the stated remote HEAD contains them.