import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { FakeSemanticJudge } from '../src/runtime/fake-semantic-judge.js';

type Fixture = { version: string; cases: Array<{ id: string; expected?: string; expectedCount?: number }> };

const benchmarkRoot = resolve(fileURLToPath(new URL('.', import.meta.url)), 'fixtures');

async function readFixture(name: string): Promise<Fixture> {
  return JSON.parse(await readFile(resolve(benchmarkRoot, name), 'utf8')) as Fixture;
}

async function main(): Promise<void> {
  const fake = new FakeSemanticJudge();
  const fixtures = await Promise.all([
    readFixture('semantic-policy.json'),
    readFixture('key-point-extraction.json'),
    readFixture('final-answer.json'),
    readFixture('prompt-injection.json'),
  ]);
  const now = Date.now();
  for (const fixture of fixtures) {
    for (const testCase of fixture.cases) {
      const output = testCase.expectedCount === undefined
        ? await fake.judgeQuestion()
        : { key_points: Array.from({ length: testCase.expectedCount }, (_, index) => ({ content: `fixture point ${index + 1}` })) };
      process.stdout.write(`${JSON.stringify({
        provider: 'fake',
        model: 'deterministic-fixture',
        skillVersion: fixture.version,
        promptVersion: fixture.version,
        schemaVersion: 'schema-v1',
        fixtureId: testCase.id,
        correct: testCase.expectedCount === undefined || output.key_points.length === testCase.expectedCount,
        schemaCompliant: true,
        latencyMs: Date.now() - now,
        inputTokens: null,
        outputTokens: null,
        costInput: null,
      })}\n`);
    }
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
