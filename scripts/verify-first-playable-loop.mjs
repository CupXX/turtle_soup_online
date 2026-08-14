import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { delimiter, join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

const workspace = new URL('..', import.meta.url);
const workspacePath = decodeURIComponent(workspace.pathname).replace(/^\/(\w):/, '$1:').replaceAll('/', '\\');
const port = Number(process.env.ACCEPTANCE_PORT ?? 3310);
const siteOrigin = `http://localhost:${port}`;
const defaultDatabaseUrl = 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';
const webDatabaseUrl = process.env.ACCEPTANCE_WEB_DATABASE_URL ?? process.env.ACCEPTANCE_DATABASE_URL ?? defaultDatabaseUrl;
const workerDatabaseUrl = process.env.ACCEPTANCE_WORKER_DATABASE_URL ?? process.env.ACCEPTANCE_DATABASE_URL ?? defaultDatabaseUrl;
const adminSecret = 'acceptance-admin-secret-123';

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function log(message) {
  console.log(`[acceptance] ${message}`);
}

function supabaseCliEnvironment() {
  const cliRoot = join(workspacePath, 'node_modules', '.pnpm', 'supabase@2.114.0', 'node_modules');
  const cliNodeModules = join(cliRoot, 'supabase', 'node_modules');
  return {
    NODE_PATH: [cliNodeModules, cliRoot, join(workspacePath, 'node_modules', '.pnpm', 'node_modules')].join(delimiter),
  };
}

async function runNodeScript(entry, args, options = {}) {
  const child = spawn(process.execPath, [entry, ...args], {
    cwd: workspacePath,
    env: { ...process.env, ...options.env },
    stdio: 'inherit',
    windowsHide: true,
  });
  log(`running ${entry} ${args.join(' ')}`);
  const result = await new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('exit', resolve);
  });
  log(`${entry} exited with ${result}`);
  if (result !== 0) throw new Error(`${entry} ${args.join(' ')} failed (${result})`);
}

async function resetLocalDatabase() {
  const supabaseEntry = join(workspacePath, 'node_modules', 'supabase', 'dist', 'supabase.js');
  await runNodeScript(supabaseEntry, ['db', 'reset', '--local'], { env: supabaseCliEnvironment() });
}

function startWebServer(env) {
  const nextEntry = join(workspacePath, 'apps', 'web', 'node_modules', 'next', 'dist', 'bin', 'next');
  const child = spawn(process.execPath, [nextEntry, 'start', '--port', String(port)], {
    cwd: join(workspacePath, 'apps', 'web'),
    env: { ...process.env, ...env, NODE_ENV: 'production' },
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });
  const output = [];
  child.stdout.on('data', (chunk) => output.push(chunk.toString()));
  child.stderr.on('data', (chunk) => output.push(chunk.toString()));
  child.on('error', (error) => output.push(`web spawn error: ${error.message}\n`));
  child.on('exit', (code, signal) => output.push(`web exited: code=${code} signal=${signal}\n`));
  return { child, output };
}

async function stopProcess(child) {
  if (!child || child.exitCode !== null) return;
  child.kill('SIGTERM');
  await Promise.race([once(child, 'exit'), delay(3000)]);
  if (child.exitCode === null) child.kill('SIGKILL');
}

async function waitForWeb(child, output) {
  let lastStatus = 'unreachable';
  let lastBody = '';
  for (let attempt = 0; attempt < 60; attempt += 1) {
    if (child.exitCode !== null) throw new Error(`web server exited early\n${output.join('')}`);
    try {
      const response = await fetch(`${siteOrigin}/api/game/current`);
      lastStatus = String(response.status);
      lastBody = await response.text();
      if (response.status === 200) return;
    } catch {
      // The production server is still booting.
    }
    await delay(250);
  }
  throw new Error(`web server did not become ready (last status ${lastStatus}: ${lastBody})\n${output.join('')}`);
}

function cookieJar() {
  return { value: '' };
}

function updateCookie(jar, response) {
  const header = response.headers.get('set-cookie');
  if (header) jar.value = header.split(';', 1)[0];
}

async function apiRequest(path, options = {}) {
  const jar = options.jar;
  const headers = new Headers(options.headers);
  headers.set('origin', siteOrigin);
  if (jar?.value) headers.set('cookie', jar.value);
  if (options.body !== undefined) {
    headers.set('content-type', 'application/json');
    if (!headers.has('idempotency-key')) headers.set('idempotency-key', randomUUID());
  }

  const response = await fetch(`${siteOrigin}${path}`, {
    method: options.method ?? 'GET',
    headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });
  if (jar) updateCookie(jar, response);
  const body = await response.json();
  if (!response.ok) throw new Error(`${path} returned ${response.status}: ${JSON.stringify(body)}`);
  return body.data;
}

async function loadWorkerModules() {
  const [queue, extraction, question, heartbeat] = await Promise.all([
    import('../services/judge-worker/dist/db/queue.js'),
    import('../services/judge-worker/dist/processors/extraction-processor.js'),
    import('../services/judge-worker/dist/processors/question-processor.js'),
    import('../services/judge-worker/dist/db/heartbeat.js'),
  ]);
  return { ...queue, ...extraction, ...question, ...heartbeat };
}

async function main() {
  if (process.env.ACCEPTANCE_SKIP_RESET === '1') {
    log('using existing local database');
  } else {
    log('resetting local database');
    await resetLocalDatabase();
    log('local database reset');
  }

  const workerEnv = {
    JUDGE_WORKER_DATABASE_URL: workerDatabaseUrl,
    JUDGE_PROVIDER: 'fake-acceptance',
    JUDGE_MODEL: 'fake-acceptance',
    JUDGE_API_BASE_URL: 'http://127.0.0.1:9',
    JUDGE_API_KEY: 'fake-acceptance',
    JUDGE_TIMEOUT_MS: '30000',
    WORKER_ID: 'acceptance-worker',
    BUILD_VERSION: 'acceptance',
  };
  const webEnv = {
    NEXT_PUBLIC_SUPABASE_URL: 'http://127.0.0.1:54321',
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'local-publishable-key',
    GAME_WEB_DATABASE_URL: webDatabaseUrl,
    SITE_ORIGIN: siteOrigin,
    PLAYER_SESSION_SECRET: 'acceptance-player-session-secret-123',
    ADMIN_SESSION_SECRET: 'acceptance-admin-session-secret-123',
    ADMIN_SECRET: adminSecret,
    IDEMPOTENCY_HMAC_SECRET: 'acceptance-idempotency-hmac-secret-123',
    IP_HASH_SECRET: 'acceptance-ip-hash-secret-123',
    RATE_LIMIT_PLAYER_JOIN_PER_MINUTE: '20',
    RATE_LIMIT_MESSAGE_PER_PLAYER_PER_MINUTE: '20',
    RATE_LIMIT_MESSAGE_PER_IP_PER_MINUTE: '40',
    RATE_LIMIT_FINAL_ANSWER_PER_PLAYER_PER_5_MINUTES: '3',
    RATE_LIMIT_ADMIN_LOGIN_PER_IP_PER_15_MINUTES: '10',
    RATE_LIMIT_ADMIN_WRITE_PER_SESSION_PER_MINUTE: '20',
  };
  Object.assign(process.env, workerEnv, webEnv);

  const web = startWebServer(webEnv);
  const { child, output } = web;
  let sql;

  try {
    log('loading worker modules');
    const worker = await loadWorkerModules();
    log('worker modules loaded');
    const requireFromWorker = createRequire(new URL('../services/judge-worker/package.json', import.meta.url));
    const postgresModule = requireFromWorker('postgres');
    sql = (postgresModule.default ?? postgresModule)(workerDatabaseUrl, { prepare: false, max: 2 });
    const transaction = (callback) => sql.begin(callback);
    log('worker database client created');
    await waitForWeb(child, output);
    log('web server ready');
    await worker.writeHeartbeat('acceptance-worker', 'acceptance', { sql });
    log('worker heartbeat written');

    const admin = cookieJar();
    log('creating game through admin routes');
    await apiRequest('/api/admin/session', {
      method: 'POST',
      jar: admin,
      body: { nickname: '主持人', secret: adminSecret },
    });
    log('admin session created');
    const created = await apiRequest('/api/admin/games', {
      method: 'POST',
      jar: admin,
      body: { puzzleSurface: '有人在雨夜捡到一把伞。', fullSolution: 'acceptance-private-solution-9f0e' },
    });
    log('admin preparation request completed');
    assert(created.status === 'WAITING' && created.gameId, 'admin preparation did not create a waiting game');

    const judge = {
      async extractKeyPoints() {
        return { key_points: [{ content: '伞柄藏着门票' }, { content: '门票属于失踪者' }, { content: '雨夜没有脚印' }] };
      },
      async judgeQuestion(input) {
        const hit = input.current_message.includes('门票');
        return {
          verdict: hit ? 'YES' : 'NO',
          fully_covered_key_point_ids: hit ? [input.key_points[0].id] : [],
        };
      },
    };
    const extractionJob = await worker.claimNextExtraction('acceptance-worker', new Date(), { transaction });
    assert(extractionJob, 'worker did not claim the extraction job');
    await worker.processExtraction(extractionJob, { judge, workerId: 'acceptance-worker', sql, transaction });
    log('extraction processed and game activated');

    const snapshotAfterActivation = await apiRequest('/api/game/current');
    assert(snapshotAfterActivation?.game.status === 'ACTIVE', 'extraction did not activate the game');
    assert(snapshotAfterActivation.game.puzzleSurface === '有人在雨夜捡到一把伞。', 'public puzzle surface mismatch');

    const playerOne = cookieJar();
    const playerTwo = cookieJar();
    const first = await apiRequest('/api/player-session', { method: 'POST', jar: playerOne, body: { nickname: '玩家甲' } });
    const second = await apiRequest('/api/player-session', { method: 'POST', jar: playerTwo, body: { nickname: '玩家乙' } });
    await apiRequest('/api/game/current/join', { method: 'POST', jar: playerOne, body: {} });
    await apiRequest('/api/game/current/join', { method: 'POST', jar: playerTwo, body: {} });

    const firstMessage = await apiRequest('/api/game/current/messages', {
      method: 'POST',
      jar: playerOne,
      body: { content: '门票是关键线索吗？' },
    });
    const secondMessage = await apiRequest('/api/game/current/messages', {
      method: 'POST',
      jar: playerTwo,
      body: { content: '雨伞的颜色重要吗？' },
    });
    assert(firstMessage.status === 'PENDING' && secondMessage.status === 'PENDING', 'questions were not accepted as pending');

    for (let index = 0; index < 2; index += 1) {
      const action = await worker.claimNextAction('acceptance-worker', new Date(), { transaction });
      assert(action, `worker did not claim question action ${index + 1}`);
      await worker.processQuestion(action, { judge, workerId: 'acceptance-worker', sql, transaction });
    }
    log('two questions judged');

    const finalSnapshot = await apiRequest('/api/game/current');
    assert(finalSnapshot.game.totalQuestionCount === 2, 'question count is not exactly two');
    assert(finalSnapshot.messages.map((message) => message.sequenceNo).join(',') === '1,2', 'receipt order changed');
    assert(finalSnapshot.messages.every((message) => message.status === 'JUDGED'), 'not every question was judged');
    assert(finalSnapshot.messages[0].verdict === 'YES' && finalSnapshot.messages[0].awardedPoints === 1, 'first-hit scoring mismatch');
    assert(finalSnapshot.messages[1].verdict === 'NO' && finalSnapshot.messages[1].awardedPoints === 0, 'second question scoring mismatch');
    assert(finalSnapshot.game.discoveredKeyPointCount === 1, 'discovered key-point count mismatch');
    const firstStats = finalSnapshot.stats.find((stats) => stats.playerId === first.playerId);
    const secondStats = finalSnapshot.stats.find((stats) => stats.playerId === second.playerId);
    assert(firstStats?.yesCount === 1 && firstStats.questionCount === 1, 'first player stats mismatch');
    assert(secondStats?.yesCount === 0 && secondStats.questionCount === 1, 'second player stats mismatch');

    const publicPayload = JSON.stringify(finalSnapshot);
    assert(!publicPayload.includes('acceptance-private-solution-9f0e'), 'private solution leaked through public snapshot');
    assert(!publicPayload.includes('伞柄藏着门票'), 'private key point leaked through public snapshot');
    console.log('first playable loop: PASS (activation, two ordered questions, verdicts, first-hit score, privacy)');
  } finally {
    log('stopping web server');
    await stopProcess(child);
    log('web server stopped');
    if (sql) {
      log('closing acceptance database client');
      await sql.end({ timeout: 2 });
      log('acceptance database client closed');
    }
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
