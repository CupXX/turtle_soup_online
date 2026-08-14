# Decision 0001: Judge Worker runtime

## Decision

**GO.** The candidate Harness runtime passes the local probe and the required
Node.js 22 Docker build/run gate. The production Worker integration can proceed;
its actual invoker still needs a separate container verification in Task 5.

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
| Docker image build | PASS | `docker build --no-cache ...` completed; Node.js `v22.23.2` image |
| Docker image run | PASS | `docker run --rm turtle-soup-harness-spike` exited 0; all three fixtures passed |

## Required follow-up

Task 5 must invoke the same Harness package through the production Worker
adapter in a Docker image and confirm its dependency build allowlist. The spike
itself is no longer an environmental blocker.
