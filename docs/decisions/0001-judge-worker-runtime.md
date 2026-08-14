# Decision 0001: Judge Worker runtime

## Decision

**NO-GO — environmental verification blocker.** The candidate Harness runtime
works in the local Node probe, but the required Docker build/run evidence cannot
be collected on this machine because the `docker` executable is unavailable.

This is not evidence that `@deepseek-ai/dsh@0.1.0-rc.6` is incompatible. The
implementation must remain stopped at Task 1 until the same image is built and
run by Docker (or the user explicitly changes the container requirement).

## Candidate

- Package: `@deepseek-ai/dsh@0.1.0-rc.6`
- Launcher entry: `lib/bin.js`
- Tarball shasum: `de9fbf39056c7f4e658a3e284cb1d66ebc86d040`
- Intended runtime: Node.js 22
- Minimal profile overlay: `spikes/deepseek-harness/profile.patch.yml`

## Evidence collected

| Acceptance item | Result | Evidence |
|---|---|---|
| Candidate package metadata | PASS | `npm view` and `npm pack --dry-run` succeeded |
| Fresh no-tool Harness invocation | PASS | `pnpm --dir spikes/deepseek-harness test`, 2/2 tests passed |
| Structured JSON and schema validation | PASS | extraction, question, and final-answer fixtures passed |
| Exactly one provider request per fixture | PASS | loopback SSE provider observed one request per run |
| Sensitive session/prompt persistence scan | PASS | `toolsExposed: []`, `persistenceFiles: []` for all fixtures |
| TypeScript strict check | PASS | `tsc --noEmit` with NodeNext/strict settings exited 0 |
| Docker image build | BLOCKED | `docker` command not found on the current machine |
| Docker image run | BLOCKED | cannot run without the image/runtime |

## Required follow-up

After Docker is installed and available on `PATH`, run:

```powershell
docker build -f spikes/deepseek-harness/Dockerfile -t turtle-soup-harness-spike .
docker run --rm turtle-soup-harness-spike
```

If both commands pass and reproduce the probe evidence, replace this decision
with **GO**, record the exact image/runtime output, and continue with Task 2.
