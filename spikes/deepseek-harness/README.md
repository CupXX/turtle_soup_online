# DeepSeek Harness feasibility spike

This spike verifies the smallest Harness profile needed by the judge worker:
one fresh headless session, one provider request, no model-facing tools, strict
JSON parsing/validation, and no sensitive prompt/session text left in the
configured Harness home.

## Candidate evidence

- Package: `@deepseek-ai/dsh@0.1.0-rc.6`
- Launcher bin: `lib/bin.js` (`dsh`)
- Published dependency metadata and `npm pack --dry-run` both succeeded.
- Tarball shasum: `de9fbf39056c7f4e658a3e284cb1d66ebc86d040`
- Probe runtime target: Node.js 22; local verification ran on Node.js `v24.14.1`.
- Probe invocation: `node node_modules/@deepseek-ai/dsh/lib/bin.js --profile headless --patch profile.patch.yml <task>`
- Profile overlay: `profile.patch.yml`

## Local verification

Run:

```powershell
pnpm test
pnpm probe
```

The probe uses a loopback OpenAI-compatible SSE provider so it never needs a
real API key. The observed result for all three fixtures was:

```json
{
  "toolsExposed": [],
  "persistenceFiles": [],
  "structuredOutput": true,
  "providerRequests": 1
}
```

The probe scans the configured Harness home for the fixture's surface,
solution, message, and key-point text. It skips dependency symlinks and does
not print the runtime-home path.

## Docker verification

The verified command is:

```powershell
docker build --no-cache -f spikes/deepseek-harness/Dockerfile -t turtle-soup-harness-spike .
docker run --rm turtle-soup-harness-spike
```

Both commands passed on 2026-08-15. The image uses Node.js `v22.23.2` from
`node:22-bookworm-slim`. The image installs `python3`, `make`, and `g++` only
to compile the allowlisted `node-pty` native dependency during `pnpm install`.
The container probe produced three structured outputs (extraction, question,
and final answer), one loopback provider request per fixture, and reported:

```json
{
  "runtime": "v22.23.2",
  "harnessVersion": "0.1.0-rc.6",
  "toolsExposed": [],
  "persistenceFiles": []
}
```

The loopback provider means this verification does not require a real API key.
The production Worker image still needs to verify its actual Harness invoker;
that is covered by Task 5 of the first-playable-loop plan.
