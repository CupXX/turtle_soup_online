import { createServer } from 'node:http';
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { spawn } from 'node:child_process';

import Ajv from 'ajv/dist/2020.js';
import type { ErrorObject, ValidateFunction } from 'ajv';

export type ProbeResult = {
  runtime: string;
  harnessVersion: string;
  toolsExposed: string[];
  persistenceFiles: string[];
  output: unknown;
};

type Fixture = {
  surface: string;
  solution: string;
  key_points?: Array<{ id: string; text: string }>;
  message?: string;
  expected_schema: Record<string, unknown>;
};

type ChildResult = {
  code: number;
  stdout: string;
  stderr: string;
};

type JsonSchemaValidator = {
  addFormat(name: string, format: RegExp): void;
  compile(schema: Record<string, unknown>): ValidateFunction;
  errorsText(errors?: ErrorObject[] | null): string;
};

const moduleDirectory = dirname(fileURLToPath(import.meta.url));
const packageRoot = resolve(moduleDirectory, '..');
const patchPath = resolve(packageRoot, 'profile.patch.yml');

function dshEntryPoint(): string {
  return resolve(packageRoot, 'node_modules/@deepseek-ai/dsh/lib/bin.js');
}

function fixtureKind(fixturePath: string): 'extraction' | 'question' | 'final-answer' {
  const name = fixturePath.split(/[\\/]/).pop() ?? '';
  if (name.startsWith('extraction-')) return 'extraction';
  if (name.startsWith('question-')) return 'question';
  if (name.startsWith('final-answer-')) return 'final-answer';
  throw new Error(`unsupported Harness fixture filename: ${name}`);
}

function expectedOutput(kind: ReturnType<typeof fixtureKind>): unknown {
  if (kind === 'question') {
    return {
      verdict: 'YES',
      fully_covered_key_point_ids: ['00000000-0000-4000-8000-000000000001'],
    };
  }
  if (kind === 'final-answer') {
    return {
      verdict: 'YES',
      covered_key_point_ids: [
        '00000000-0000-4000-8000-000000000001',
        '00000000-0000-4000-8000-000000000002',
        '00000000-0000-4000-8000-000000000003',
      ],
    };
  }
  return {
    key_points: [
      { text: '客人用伞柄敲门求救' },
      { text: '客人从暗门离开' },
      { text: '老板误以为房间一直没有人' },
    ],
  };
}

function ssePayload(output: unknown): string {
  const delta = JSON.stringify({
    id: 'probe-response',
    object: 'chat.completion.chunk',
    created: 0,
    model: 'deepseek-v4-flash',
    choices: [{ index: 0, delta: { content: JSON.stringify(output) }, finish_reason: null }],
  });
  const finish = JSON.stringify({
    id: 'probe-response',
    object: 'chat.completion.chunk',
    created: 0,
    model: 'deepseek-v4-flash',
    choices: [{ index: 0, delta: {}, finish_reason: 'stop' }],
    usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
  });
  return `data: ${delta}\n\ndata: ${finish}\n\ndata: [DONE]\n\n`;
}

async function startMockProvider(kind: ReturnType<typeof fixtureKind>): Promise<{
  url: string;
  tools: Set<string>;
  requests: { count: number };
  close(): Promise<void>;
}> {
  const tools = new Set<string>();
  const requests = { count: 0 };
  const server = createServer((request, response) => {
    if (request.method !== 'POST' || request.url !== '/chat/completions') {
      response.writeHead(404).end();
      return;
    }

    const chunks: Buffer[] = [];
    request.on('data', (chunk: Buffer) => chunks.push(chunk));
    request.on('end', () => {
      requests.count += 1;
      try {
        const body = JSON.parse(Buffer.concat(chunks).toString('utf8')) as {
          tools?: Array<{ function?: { name?: string } }>;
        };
        for (const tool of body.tools ?? []) {
          if (tool.function?.name) tools.add(tool.function.name);
        }
        response.writeHead(200, {
          'content-type': 'text/event-stream',
          'cache-control': 'no-cache',
          connection: 'close',
        });
        response.end(ssePayload(expectedOutput(kind)));
      } catch (error) {
        response.writeHead(400, { 'content-type': 'application/json' });
        response.end(JSON.stringify({ error: { message: String(error) } }));
      }
    });
  });

  await new Promise<void>((resolvePromise, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolvePromise());
  });
  const address = server.address();
  if (!address || typeof address === 'string') {
    await new Promise<void>((resolvePromise) => server.close(() => resolvePromise()));
    throw new Error('mock provider did not expose a TCP address');
  }

  return {
    url: `http://127.0.0.1:${address.port}`,
    tools,
    requests,
    close: () => new Promise<void>((resolvePromise, reject) => {
      server.close((error) => (error ? reject(error) : resolvePromise()));
    }),
  };
}

function runChild(command: string, args: string[], environment: NodeJS.ProcessEnv, cwd: string): Promise<ChildResult> {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, {
      cwd,
      env: environment,
      shell: false,
      windowsHide: true,
    });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    child.stdout.on('data', (chunk: Buffer) => stdout.push(chunk));
    child.stderr.on('data', (chunk: Buffer) => stderr.push(chunk));
    child.once('error', reject);
    child.once('close', (code) => {
      resolvePromise({
        code: code ?? 1,
        stdout: Buffer.concat(stdout).toString('utf8'),
        stderr: Buffer.concat(stderr).toString('utf8'),
      });
    });
  });
}

function parseOutput(stdout: string): unknown {
  const lines = stdout.trim().split(/\r?\n/).filter(Boolean).reverse();
  for (const line of lines) {
    try {
      return JSON.parse(line);
    } catch {
      // The headless launcher should print only the assistant value, but keep
      // the parser tolerant of one diagnostic line before that final value.
    }
  }
  throw new Error(`Harness stdout did not contain one JSON value: ${stdout}`);
}

async function collectSensitiveFiles(runtimeHome: string, markers: string[]): Promise<string[]> {
  const hits: string[] = [];
  async function visit(directory: string): Promise<void> {
    const entries = await readdir(directory, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.name === 'node_modules' || entry.isSymbolicLink()) continue;
      const fullPath = resolve(directory, entry.name);
      if (entry.isDirectory()) {
        await visit(fullPath);
        continue;
      }
      const file = await readFile(fullPath).catch(() => undefined);
      if (!file) continue;
      const text = file.toString('utf8');
      if (markers.some((marker) => marker.length > 0 && text.includes(marker))) {
        hits.push(fullPath);
      }
    }
  }
  await visit(runtimeHome);
  return hits.sort();
}

async function readHarnessVersion(): Promise<string> {
  const packageJson = JSON.parse(
    await readFile(resolve(packageRoot, 'node_modules/@deepseek-ai/dsh/package.json'), 'utf8'),
  ) as { version?: unknown };
  if (typeof packageJson.version !== 'string') throw new Error('Harness package has no version');
  return packageJson.version;
}

export async function runProbe(
  fixturePath: string,
  schemaPath: string,
  runtimeHome: string,
): Promise<ProbeResult> {
  const fixture = JSON.parse(await readFile(fixturePath, 'utf8')) as Fixture;
  const schema = JSON.parse(await readFile(schemaPath, 'utf8')) as Record<string, unknown>;
  const kind = fixtureKind(fixturePath);
  const provider = await startMockProvider(kind);
  const task = JSON.stringify({
    purpose: 'single-json-value-probe',
    fixture: kind,
    input: {
      surface: fixture.surface,
      solution: fixture.solution,
      key_points: fixture.key_points,
      message: fixture.message,
    },
    output_schema: schema,
  });

  try {
    const environment: NodeJS.ProcessEnv = {
      ...process.env,
      DSH_HOME: runtimeHome,
      DSH_CWD: runtimeHome,
      DSH_PERMISSION_MODE: 'read-only',
      DSH_TELEMETRY_MODE: 'DISABLED',
      DEEPSEEK_API_KEY: 'turtle-soup-harness-probe-key',
      DEEPSEEK_BASE_URL: provider.url,
    };
    const child = await runChild(
      process.execPath,
      [dshEntryPoint(), '--profile', 'headless', '--patch', patchPath, task],
      environment,
      runtimeHome,
    );
    if (child.code !== 0) {
      throw new Error(`Harness exited with ${child.code}: ${child.stderr || child.stdout}`);
    }
    if (provider.requests.count !== 1) {
      throw new Error(`expected one provider request, received ${provider.requests.count}`);
    }

    const output = parseOutput(child.stdout);
    const AjvConstructor = Ajv as unknown as new (options?: { strict?: boolean }) => JsonSchemaValidator;
    const ajv = new AjvConstructor({ strict: false });
    ajv.addFormat('uuid', /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
    const validate = ajv.compile(schema);
    if (!validate(output)) {
      throw new Error(`Harness output failed schema validation: ${ajv.errorsText(validate.errors)}`);
    }

    const persistenceFiles = await collectSensitiveFiles(runtimeHome, [
      fixture.surface,
      fixture.solution,
      fixture.message ?? '',
      ...(fixture.key_points ?? []).map((point) => point.text),
    ]);
    return {
      runtime: process.version,
      harnessVersion: await readHarnessVersion(),
      toolsExposed: [...provider.tools].sort(),
      persistenceFiles,
      output,
    };
  } finally {
    await provider.close();
  }
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  const fixtures = ['extraction-input.json', 'question-input.json', 'final-answer-input.json'];
  const schemaDir = resolve(packageRoot, 'fixtures');
  const configuredHome = process.env.DSH_HOME;
  const runtimeHome = configuredHome ?? await mkdtemp(resolve(tmpdir(), 'turtle-soup-harness-probe-'));
  const results: ProbeResult[] = [];
  try {
    for (const fixture of fixtures) {
      const fixturePath = resolve(schemaDir, fixture);
      const input = JSON.parse(await readFile(fixturePath, 'utf8')) as Fixture;
      const schemaPath = resolve(runtimeHome, `${fixture}.schema.json`);
      await mkdir(runtimeHome, { recursive: true });
      await writeFile(schemaPath, JSON.stringify(input.expected_schema), 'utf8');
      results.push(await runProbe(fixturePath, schemaPath, runtimeHome));
    }
    process.stdout.write(`${JSON.stringify(results)}\n`);
  } finally {
    if (!configuredHome) await rm(runtimeHome, { recursive: true, force: true });
  }
}
