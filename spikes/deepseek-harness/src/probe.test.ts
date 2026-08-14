import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { expect, test } from 'vitest';

type ProbeResult = {
  runtime: string;
  harnessVersion: string;
  toolsExposed: string[];
  persistenceFiles: string[];
  output: unknown;
};

type ProbeModule = {
  runProbe(
    fixturePath: string,
    schemaPath: string,
    runtimeHome: string,
  ): Promise<ProbeResult>;
};

async function loadProbe(): Promise<ProbeModule | undefined> {
  try {
    return (await import('./probe.js')) as ProbeModule;
  } catch {
    return undefined;
  }
}

async function runFixture(fixtureName: string): Promise<ProbeResult> {
  const probe = await loadProbe();
  expect(probe?.runProbe).toBeTypeOf('function');
  if (!probe) {
    throw new Error('probe module is not implemented');
  }

  const fixturePath = resolve('fixtures', fixtureName);
  const fixture = JSON.parse(await readFile(fixturePath, 'utf8')) as {
    expected_schema: object;
  };
  const runtimeHome = await mkdtemp(resolve(tmpdir(), 'turtle-soup-harness-test-'));
  const schemaPath = resolve(runtimeHome, 'schema.json');

  try {
    await writeFile(schemaPath, JSON.stringify(fixture.expected_schema), 'utf8');
    return await probe.runProbe(fixturePath, schemaPath, runtimeHome);
  } finally {
    await rm(runtimeHome, { recursive: true, force: true });
  }
}

test('runs one isolated question fixture without tools or persisted sensitive input', async () => {
  const result = await runFixture('question-input.json');

  expect(result.toolsExposed).toEqual([]);
  expect(result.persistenceFiles).toEqual([]);
  expect(result.output).toEqual({
    verdict: 'YES',
    fully_covered_key_point_ids: ['00000000-0000-4000-8000-000000000001'],
  });
}, 120_000);

test('uses the same isolated Harness contract for extraction and final-answer fixtures', async () => {
  const extraction = await runFixture('extraction-input.json');
  const finalAnswer = await runFixture('final-answer-input.json');

  expect(extraction.toolsExposed).toEqual([]);
  expect(extraction.persistenceFiles).toEqual([]);
  expect(finalAnswer.toolsExposed).toEqual([]);
  expect(finalAnswer.persistenceFiles).toEqual([]);
  expect(finalAnswer.output).toEqual({
    verdict: 'YES',
    covered_key_point_ids: [
      '00000000-0000-4000-8000-000000000001',
      '00000000-0000-4000-8000-000000000002',
      '00000000-0000-4000-8000-000000000003',
    ],
  });
}, 120_000);
