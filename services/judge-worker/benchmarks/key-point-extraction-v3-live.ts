import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import type { KeyPointExtractionInput, KeyPointExtractionResult } from '@turtle-soup/contracts';
import { OpenAIResponsesSemanticJudge } from '../src/runtime/openai-responses-semantic-judge.js';
import { SemanticJudgeRuntimeError } from '../src/runtime/semantic-judge.js';
import { KEY_POINT_EXTRACTION_PROMPT_VERSION } from '../src/skills/key-point-extraction.js';
import { validateKeyPointExtractionResult } from '../src/skills/validate-result.js';

export const EXTRACTION_MODEL_CONFIGURATION = {
  label: 'GPT-5.6 Luna / medium',
  provider: 'openai',
  model: 'gpt-5.6-luna',
  reasoningEffort: 'medium' as const,
};

const REPOSITORY_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
export const EXTRACTION_FORMAL_REPORT_PATH = resolve(REPOSITORY_ROOT, 'docs/reports/2026-08-16-key-point-extraction-v3-regression.md');

type ExtractionPuzzle = {
  id: string;
  puzzle_surface: string;
  full_solution: string;
  expected_semantics: string[];
};

type ExtractionFixture = {
  dataset: 'key_point_extraction_v3_regression';
  puzzles: ExtractionPuzzle[];
};

export type ExtractionAttempt = {
  round: number;
  puzzleId: string;
  model: string;
  reasoningEffort: string;
  schemaValid: boolean;
  pointCount: number;
  keyPoints: string[];
  latencyMs: number | null;
  inputTokens: number | null;
  outputTokens: number | null;
  costUsd: number | null;
  errorCode: string | null;
};

type ExtractionUsageResult = {
  result: KeyPointExtractionResult;
  inputTokens?: number | null;
  outputTokens?: number | null;
  costUsd?: number | null;
};

type ExtractionJudge = {
  extractKeyPoints(input: KeyPointExtractionInput): Promise<KeyPointExtractionResult | ExtractionUsageResult>;
};

export type ExtractionBenchmarkOptions = {
  rounds: number;
  writeReports: boolean;
  reportPath?: string;
};

export type ExtractionBenchmarkDependencies = {
  loadFixture?: () => Promise<ExtractionFixture>;
  judgeFactory?: () => ExtractionJudge | Promise<ExtractionJudge>;
  writeFile?: typeof writeFile;
  mkdir?: typeof mkdir;
  now?: () => Date;
  log?: (line: string) => void;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function errorCode(error: unknown): string {
  if (typeof error === 'object' && error !== null && 'code' in error && typeof error.code === 'string') return error.code;
  if (error instanceof Error && error.name) return error.name;
  return 'UNKNOWN_ERROR';
}

function validateFixture(value: unknown): ExtractionFixture {
  if (!isRecord(value) || value.dataset !== 'key_point_extraction_v3_regression' || !Array.isArray(value.puzzles) || value.puzzles.length !== 2) {
    throw new Error('invalid key-point extraction v3 fixture');
  }
  const puzzles = value.puzzles.map((raw, index) => {
    if (!isRecord(raw) || typeof raw.id !== 'string' || typeof raw.puzzle_surface !== 'string' || typeof raw.full_solution !== 'string' || !Array.isArray(raw.expected_semantics) || raw.expected_semantics.length !== 3 || raw.expected_semantics.some((item) => typeof item !== 'string' || !item.trim())) {
      throw new Error(`invalid extraction puzzle at index ${index}`);
    }
    return {
      id: raw.id,
      puzzle_surface: raw.puzzle_surface,
      full_solution: raw.full_solution,
      expected_semantics: raw.expected_semantics as string[],
    };
  });
  if (new Set(puzzles.map(({ id }) => id)).size !== puzzles.length) throw new Error('duplicate extraction puzzle id');
  return { dataset: 'key_point_extraction_v3_regression', puzzles };
}

export async function loadExtractionFixture(path = fileURLToPath(new URL('./fixtures/key-point-extraction-v3-regression.json', import.meta.url))): Promise<ExtractionFixture> {
  const file = await import('node:fs/promises');
  const raw = await file.readFile(path, 'utf8');
  return validateFixture(JSON.parse(raw) as unknown);
}

export function parseExtractionBenchmarkArgs(argv: string[]): ExtractionBenchmarkOptions {
  let rounds = 5;
  let writeReports = true;
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--no-write') {
      writeReports = false;
      continue;
    }
    if (argument === '--rounds') {
      const value = Number(argv[++index]);
      if (!Number.isInteger(value) || value <= 0) throw new Error('--rounds must be a positive integer');
      rounds = value;
      continue;
    }
    throw new Error(`unknown argument: ${argument}`);
  }
  return { rounds, writeReports };
}

function defaultJudgeFactory(): ExtractionJudge {
  const timeoutMs = Number(process.env.JUDGE_TIMEOUT_MS ?? '30000');
  const apiKey = process.env.OPENAI_API_KEY?.trim();
  if (!Number.isInteger(timeoutMs) || timeoutMs <= 0) throw new Error('JUDGE_TIMEOUT_MS must be a positive integer');
  if (!apiKey) throw new Error('OPENAI_API_KEY is required for extraction benchmark');
  return new OpenAIResponsesSemanticJudge({
    apiBaseUrl: process.env.OPENAI_API_BASE_URL?.trim() || 'https://api.openai.com/v1',
    apiKey,
    model: EXTRACTION_MODEL_CONFIGURATION.model,
    reasoningEffort: EXTRACTION_MODEL_CONFIGURATION.reasoningEffort,
    timeoutMs,
  });
}

function usageResult(value: KeyPointExtractionResult | ExtractionUsageResult): ExtractionUsageResult {
  if (isRecord(value) && 'result' in value && isRecord(value.result) && Array.isArray(value.result.key_points)) return value as ExtractionUsageResult;
  return { result: value as KeyPointExtractionResult, inputTokens: null, outputTokens: null, costUsd: null };
}

function report(fixture: ExtractionFixture, attempts: ExtractionAttempt[], generatedAt: string): string {
  const lines = [
    '# Key Point Extraction v3 regression',
    '',
    `- Generated: ${generatedAt}`,
    `- Prompt: ${KEY_POINT_EXTRACTION_PROMPT_VERSION}`,
    `- Configuration: ${EXTRACTION_MODEL_CONFIGURATION.label}`,
    `- Attempts: ${attempts.length}`,
    '',
    '## Approved semantic targets',
    '',
  ];
  for (const puzzle of fixture.puzzles) {
    lines.push(`### ${puzzle.id}`, '', `- Surface: ${puzzle.puzzle_surface}`, `- Solution: ${puzzle.full_solution}`, '- Expected semantic units:', ...puzzle.expected_semantics.map((item, index) => `  ${index + 1}. ${item}`), '');
  }
  lines.push('## Raw extraction outputs', '', '| Round | Puzzle | Schema | Points | Latency ms | Input tokens | Output tokens | Error |', '| ---: | --- | --- | ---: | ---: | ---: | ---: | --- |');
  for (const attempt of attempts) {
    lines.push(`| ${attempt.round} | ${attempt.puzzleId} | ${attempt.schemaValid ? 'valid' : 'invalid'} | ${attempt.pointCount} | ${attempt.latencyMs ?? 'N/A'} | ${attempt.inputTokens ?? 'N/A'} | ${attempt.outputTokens ?? 'N/A'} | ${attempt.errorCode ?? '—'} |`);
    lines.push(`|  | ${attempt.puzzleId} output |  |  |  |  |  | ${attempt.keyPoints.join(' / ') || '—'} |`);
  }
  lines.push('', '## Review rule', '', '- The runner validates only schema, 3–5 count, non-empty content, and duplicate rejection. Semantic paraphrases must be reviewed against the approved independent-discovery targets above; this report does not use brittle keyword matching.', '');
  return `${lines.join('\n').trimEnd()}\n`;
}

export async function runKeyPointExtractionV3Regression(
  options: ExtractionBenchmarkOptions,
  dependencies: ExtractionBenchmarkDependencies = {},
): Promise<{ fixture: ExtractionFixture; attempts: ExtractionAttempt[]; reportPath: string }> {
  const fixture = await (dependencies.loadFixture ?? loadExtractionFixture)();
  const judge = await (dependencies.judgeFactory ?? defaultJudgeFactory)();
  const attempts: ExtractionAttempt[] = [];
  const log = dependencies.log ?? console.log;
  for (let round = 1; round <= options.rounds; round += 1) {
    for (const puzzle of fixture.puzzles) {
      const input: KeyPointExtractionInput = { puzzle_surface: puzzle.puzzle_surface, full_solution: puzzle.full_solution };
      const startedAt = performance.now();
      let schemaValid = false;
      let keyPoints: string[] = [];
      let inputTokens: number | null = null;
      let outputTokens: number | null = null;
      let costUsd: number | null = null;
      let error: string | null = null;
      try {
        const raw = usageResult(await judge.extractKeyPoints(input));
        const result = validateKeyPointExtractionResult(raw.result);
        schemaValid = true;
        keyPoints = result.key_points.map(({ content }) => content);
        inputTokens = raw.inputTokens ?? null;
        outputTokens = raw.outputTokens ?? null;
        costUsd = raw.costUsd ?? null;
      } catch (caught) {
        error = errorCode(caught);
      }
      const latencyMs = Math.max(0, Math.round(performance.now() - startedAt));
      const attempt: ExtractionAttempt = { round, puzzleId: puzzle.id, model: EXTRACTION_MODEL_CONFIGURATION.model, reasoningEffort: EXTRACTION_MODEL_CONFIGURATION.reasoningEffort, schemaValid, pointCount: keyPoints.length, keyPoints, latencyMs, inputTokens, outputTokens, costUsd, errorCode: error };
      attempts.push(attempt);
      log(`[${attempts.length}] ${puzzle.id} round=${round} valid=${schemaValid ? 'yes' : 'no'} latency=${latencyMs}ms${error ? ` error=${error}` : ''}`);
    }
  }
  const reportPath = options.reportPath ?? EXTRACTION_FORMAL_REPORT_PATH;
  if (options.writeReports) {
    const makeDirectory = dependencies.mkdir ?? mkdir;
    const write = dependencies.writeFile ?? writeFile;
    await makeDirectory(dirname(reportPath), { recursive: true });
    await write(reportPath, report(fixture, attempts, (dependencies.now ?? (() => new Date()))().toISOString()), 'utf8');
  }
  return { fixture, attempts, reportPath };
}

async function main(): Promise<void> {
  await runKeyPointExtractionV3Regression(parseExtractionBenchmarkArgs(process.argv.slice(2)));
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  void main().catch((error) => {
    const code = error instanceof SemanticJudgeRuntimeError ? error.code : 'BENCHMARK_ERROR';
    console.error(`${code}: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  });
}
