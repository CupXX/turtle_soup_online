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

async function apiErrorStatus(path, options = {}) {
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
  return { status: response.status, body: await response.json() };
}

async function loadWorkerModules() {
  const [queue, extraction, question, finalAnswer, challenge, actionProcessor, completeFinalAnswer, heartbeat, progressSummaryQueue, progressSummaryProcessor] = await Promise.all([
    import('../services/judge-worker/dist/db/queue.js'),
    import('../services/judge-worker/dist/processors/extraction-processor.js'),
    import('../services/judge-worker/dist/processors/question-processor.js'),
    import('../services/judge-worker/dist/processors/final-answer-processor.js'),
    import('../services/judge-worker/dist/processors/challenge-processor.js'),
    import('../services/judge-worker/dist/processors/action-processor.js'),
    import('../services/judge-worker/dist/db/complete-final-answer.js'),
    import('../services/judge-worker/dist/db/heartbeat.js'),
    import('../services/judge-worker/dist/db/progress-summary-queue.js'),
    import('../services/judge-worker/dist/processors/progress-summary-processor.js'),
  ]);
  return {
    ...queue,
    ...extraction,
    ...question,
    ...finalAnswer,
    ...challenge,
    ...actionProcessor,
    ...completeFinalAnswer,
    ...heartbeat,
    ...progressSummaryQueue,
    ...progressSummaryProcessor,
  };
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

    const summaryInputs = [];
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
      async judgeFinalAnswer(input) {
        return {
          covered_key_point_ids: input.final_answer.includes('complete')
            ? input.key_points.map((point) => point.id)
            : input.key_points.slice(0, Math.max(0, input.key_points.length - 1)).map((point) => point.id),
        };
      },
      async summarizeProgress(input) {
        summaryInputs.push(input);
        return {
          confirmed_facts: input.questions
            .filter((question) => question.verdict === 'YES')
            .slice(0, 4)
            .map((question) => `确认：${question.question}`),
          ruled_out_facts: input.questions
            .filter((question) => question.verdict === 'NO')
            .slice(0, 4)
            .map((question) => `排除：${question.question}`),
          irrelevant_topics: input.questions
            .filter((question) => question.verdict === 'IRRELEVANT')
            .slice(0, 4)
            .map((question) => `无关：${question.question}`),
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
    const extraPlayers = [];
    for (let index = 3; index <= 10; index += 1) {
      const jar = cookieJar();
      await apiRequest('/api/player-session', { method: 'POST', jar, body: { nickname: `player-${index}` } });
      await apiRequest('/api/game/current/join', { method: 'POST', jar, body: {} });
      extraPlayers.push(jar);
    }
    const tenPlayerSnapshot = await apiRequest('/api/game/current');
    assert(tenPlayerSnapshot.players.length === 10, 'ten-player join smoke test did not reach ten active players');

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

    const twoQuestionSnapshot = await apiRequest('/api/game/current');
    assert(twoQuestionSnapshot.game.totalQuestionCount === 2, 'question count is not exactly two');
    assert(twoQuestionSnapshot.messages.map((message) => message.sequenceNo).join(',') === '1,2', 'receipt order changed');
    assert(twoQuestionSnapshot.messages.every((message) => message.status === 'JUDGED'), 'not every question was judged');
    assert(twoQuestionSnapshot.messages[0].verdict === 'YES' && twoQuestionSnapshot.messages[0].awardedPoints === 1, 'first-hit scoring mismatch');
    assert(twoQuestionSnapshot.messages[1].verdict === 'NO' && twoQuestionSnapshot.messages[1].awardedPoints === 0, 'second question scoring mismatch');
    assert(twoQuestionSnapshot.game.discoveredKeyPointCount === 1, 'discovered key-point count mismatch');
    const firstStats = twoQuestionSnapshot.stats.find((stats) => stats.playerId === first.playerId);
    const secondStats = twoQuestionSnapshot.stats.find((stats) => stats.playerId === second.playerId);
    assert(firstStats?.yesCount === 1 && firstStats.questionCount === 1, 'first player stats mismatch');
    assert(secondStats?.yesCount === 0 && secondStats.questionCount === 1, 'second player stats mismatch');

    for (let index = 3; index <= 10; index += 1) {
      const jar = index % 2 === 0 ? playerTwo : playerOne;
      const receipt = await apiRequest('/api/game/current/messages', {
        method: 'POST',
        jar,
        body: { content: index % 2 === 0 ? `普通问题 ${index}？` : `门票线索 ${index}？` },
      });
      assert(receipt.status === 'PENDING' && receipt.sequenceNo === index, `boundary question ${index} receipt mismatch`);
    }
    for (let index = 3; index <= 10; index += 1) {
      const action = await worker.claimNextAction('acceptance-worker', new Date(), { transaction });
      assert(action && action.actionType === 'QUESTION' && Number(action.sequenceNo) === index, `worker did not claim boundary question ${index}`);
      await worker.processQuestion(action, { judge, workerId: 'acceptance-worker', sql, transaction });
    }
    log('ten questions judged');

    const boundarySnapshot = await apiRequest('/api/game/current');
    assert(boundarySnapshot.game.totalQuestionCount === 10, 'boundary question count is not exactly ten');
    assert(boundarySnapshot.messages.slice(0, 10).every((message) => message.status === 'JUDGED'), 'boundary questions were not all judged');
    const boundaryJob = await worker.claimNextProgressSummary('acceptance-worker', new Date(), { transaction });
    assert(boundaryJob, 'worker did not claim boundary-10 progress summary job');
    assert(boundaryJob.throughQuestionCount === 10 && boundaryJob.throughSequenceNo === 10, 'boundary-10 job target mismatch');
    await worker.processProgressSummary(boundaryJob, { judge, workerId: 'acceptance-worker', sql, transaction });

    const readyBoundarySnapshot = await apiRequest('/api/game/current');
    const readyBoundarySummary = readyBoundarySnapshot.progressSummary;
    assert(readyBoundarySummary?.generationStatus === 'READY', 'boundary-10 progress summary is not READY');
    assert(readyBoundarySummary.throughQuestionCount === 10 && readyBoundarySummary.throughSequenceNo === 10, 'boundary-10 public summary target mismatch');
    assert(readyBoundarySummary.confirmedFacts.length + readyBoundarySummary.ruledOutFacts.length + readyBoundarySummary.irrelevantTopics.length > 0, 'boundary-10 summary is empty');
    assert(summaryInputs.length === 1, 'boundary-10 summary did not call the fake summarizer exactly once');
    assert(Object.keys(summaryInputs[0]).join(',') === 'questions', 'summary input contains non-public top-level fields');
    assert(summaryInputs[0].questions.every((question) => Object.keys(question).sort().join(',') === 'question,sequence_no,verdict'), 'summary input contains private question fields');
    const boundaryPublicPayload = JSON.stringify(readyBoundarySnapshot);
    assert(!boundaryPublicPayload.includes('acceptance-private-solution-9f0e'), 'progress summary snapshot leaked the private solution');
    assert(!boundaryPublicPayload.includes('伞柄藏着门票'), 'progress summary snapshot leaked private key points');
    assert(!boundaryPublicPayload.includes('evidence'), 'progress summary snapshot leaked private evidence');

    await worker.writeHeartbeat('acceptance-worker', 'acceptance', { sql });
    const challengeReceipt = await apiRequest('/api/game/current/messages/challenge', {
      method: 'POST',
      jar: playerTwo,
      body: { messageId: firstMessage.id },
    });
    assert(challengeReceipt.status === 'PENDING' && challengeReceipt.messageId === firstMessage.id, 'challenge receipt mismatch');
    const challengeAction = await worker.claimNextAction('acceptance-worker', new Date(), { transaction });
    assert(challengeAction && challengeAction.actionType === 'CHALLENGE', 'worker did not claim challenge action');
    const challengeJudge = {
      ...judge,
      async judgeQuestion() {
        return { verdict: 'NO', fully_covered_key_point_ids: [] };
      },
    };
    await worker.processChallenge(challengeAction, {
      judge,
      judgeFactory: () => challengeJudge,
      workerId: 'acceptance-worker',
      sql,
      transaction,
    });

    const refreshedJob = await worker.claimNextProgressSummary('acceptance-worker', new Date(), { transaction });
    assert(refreshedJob, 'worker did not claim challenge refresh progress summary job');
    assert(refreshedJob.throughQuestionCount === 10 && refreshedJob.throughSequenceNo === 10, 'challenge refresh target mismatch');
    assert(refreshedJob.sourceFingerprint !== boundaryJob.sourceFingerprint, 'challenge did not produce a new source fingerprint');
    await worker.processProgressSummary(refreshedJob, { judge, workerId: 'acceptance-worker', sql, transaction });

    const challengeSnapshot = await apiRequest('/api/game/current');
    assert(challengeSnapshot.messages[0].verdict === 'NO' && challengeSnapshot.messages[0].challengeStatus === 'RESOLVED', 'challenge did not change the public verdict');
    assert(challengeSnapshot.progressSummary?.generationStatus === 'READY', 'challenge refresh summary is not READY');
    assert(JSON.stringify(challengeSnapshot.progressSummary?.confirmedFacts) !== JSON.stringify(readyBoundarySummary.confirmedFacts), 'challenge refresh did not change the summary content');
    assert(summaryInputs.length === 2, 'challenge refresh did not call the fake summarizer exactly once');
    const boundaryJobs = await sql`
      select
        id,
        through_question_count as "throughQuestionCount",
        through_sequence_no as "throughSequenceNo",
        source_fingerprint as "sourceFingerprint",
        status
      from private.progress_summary_jobs
      where game_id = ${created.gameId}
        and through_question_count = 10
      order by created_at asc
    `;
    assert(boundaryJobs.length === 2, 'challenge refresh did not create exactly two boundary-10 jobs');
    assert(boundaryJobs[0].sourceFingerprint !== boundaryJobs[1].sourceFingerprint, 'boundary-10 job fingerprints are not distinct');

    const finalSnapshot = challengeSnapshot;

    const failedReceipt = await apiRequest('/api/game/current/final-answers', {
      method: 'POST',
      jar: playerTwo,
      body: { answer: 'partial answer' },
    });
    assert(failedReceipt.status === 'PENDING' && failedReceipt.sequenceNo === 12, 'partial final-answer receipt mismatch');
    const failedAction = await worker.claimNextAction('acceptance-worker', new Date(), { transaction });
    assert(Number(failedAction?.sequenceNo) === 12 && failedAction.actionType === 'FINAL_ANSWER', 'worker did not claim partial final answer');
    await worker.processFinalAnswer(failedAction, {
      judge,
      workerId: 'acceptance-worker',
      sql,
      completeFinalAnswer: (input) => worker.completeFinalAnswer(input, { transaction }),
    });
    const failedSnapshot = await apiRequest('/api/game/current');
    assert(failedSnapshot.game.status === 'ACTIVE' && failedSnapshot.events.some((event) => event.eventType === 'FINAL_ANSWER_FAILED'), 'partial final answer did not fail publicly');
    assert(!JSON.stringify(failedSnapshot).includes('partial answer'), 'partial final answer leaked through public snapshot');

    const successReceipt = await apiRequest('/api/game/current/final-answers', {
      method: 'POST',
      jar: playerOne,
      body: { answer: 'complete answer' },
    });
    assert(successReceipt.status === 'PENDING' && successReceipt.sequenceNo === 13, 'successful final-answer receipt mismatch');
    const laterMessage = await apiRequest('/api/game/current/messages', {
      method: 'POST',
      jar: playerTwo,
      body: { content: 'this arrives after the final answer' },
    });
    assert(laterMessage.sequenceNo === 14, 'later action did not receive sequence fourteen');
    const successAction = await worker.claimNextAction('acceptance-worker', new Date(), { transaction });
    assert(Number(successAction?.sequenceNo) === 13 && successAction.actionType === 'FINAL_ANSWER', 'worker did not claim successful final answer');
    await worker.processFinalAnswer(successAction, {
      judge,
      workerId: 'acceptance-worker',
      sql,
      completeFinalAnswer: (input) => worker.completeFinalAnswer(input, { transaction }),
    });

    const endedSnapshot = await apiRequest('/api/game/current');
    assert(endedSnapshot.game.status === 'ENDED' && endedSnapshot.game.endReason === 'FINAL_ANSWER_SUCCESS', 'full final answer did not end the game');
    assert(endedSnapshot.game.winnerPlayerId === first.playerId, 'winner was not recorded');
    assert(endedSnapshot.events.some((event) => event.eventType === 'FINAL_ANSWER_SUCCEEDED' && event.awardedPoints === 2), 'success event or +2 reward missing');
    assert(endedSnapshot.reveal?.fullSolution === 'acceptance-private-solution-9f0e', 'success reveal missing');
    assert(endedSnapshot.messages.find((message) => message.id === laterMessage.id)?.status === 'CANCELLED', 'later action was not cancelled');
    assert(!JSON.stringify(endedSnapshot).includes('complete answer'), 'successful final answer leaked through public snapshot');
    const endedSubmission = await apiErrorStatus('/api/game/current/final-answers', {
      method: 'POST',
      jar: playerTwo,
      body: { answer: 'after end' },
    });
    assert(endedSubmission.status === 409 && endedSubmission.body.error?.code === 'GAME_NOT_ACTIVE', 'ended game accepted a final answer');

    const scoreBeforeForceEnd = endedSnapshot.players.find((player) => player.id === first.playerId)?.lifetimeScore ?? 0;
    await apiRequest('/api/admin/games', {
      method: 'POST',
      jar: admin,
      body: { puzzleSurface: 'second game surface', fullSolution: 'second game private solution' },
    });
    const secondExtraction = await worker.claimNextExtraction('acceptance-worker', new Date(), { transaction });
    assert(secondExtraction, 'worker did not claim second extraction job');
    await worker.processExtraction(secondExtraction, { judge, workerId: 'acceptance-worker', sql, transaction });
    await apiRequest('/api/game/current/join', { method: 'POST', jar: playerOne, body: {} });
    const pendingBeforeForceEnd = await apiRequest('/api/game/current/messages', {
      method: 'POST',
      jar: playerOne,
      body: { content: 'pending before force end' },
    });
    const forceResult = await apiRequest('/api/admin/games/current/force-end', {
      method: 'POST',
      jar: admin,
      body: { confirmation: 'FORCE_END' },
    });
    assert(forceResult.status === 'ENDED' && forceResult.endReason === 'FORCE_ENDED', 'force end response mismatch');
    const forceSnapshot = await apiRequest('/api/game/current');
    assert(forceSnapshot.game.endReason === 'FORCE_ENDED', 'force-end reason missing');
    assert(forceSnapshot.events.some((event) => event.eventType === 'FORCE_ENDED' && event.awardedPoints === 0), 'force-end event mismatch');
    assert(forceSnapshot.reveal?.fullSolution === 'second game private solution', 'force-end reveal missing');
    assert(forceSnapshot.messages.find((message) => message.id === pendingBeforeForceEnd.id)?.status === 'CANCELLED', 'force end did not cancel pending message');
    assert((forceSnapshot.players.find((player) => player.id === first.playerId)?.lifetimeScore ?? 0) === scoreBeforeForceEnd, 'force end changed lifetime score');

    const fixtureGameId = randomUUID();
    const fixturePlayerId = randomUUID();
    await sql.begin(async (fixtureTransaction) => {
      await fixtureTransaction`
        insert into api.players (id, display_nickname)
        values (${fixturePlayerId}, 'summary-fixture')
      `;
      await fixtureTransaction`
        insert into api.games (
          id,
          status,
          puzzle_surface,
          key_point_total,
          discovered_key_point_count,
          total_question_count,
          activated_at
        ) values (
          ${fixtureGameId},
          'ACTIVE',
          'startup summary fixture surface',
          0,
          0,
          41,
          now()
        )
      `;
      for (let index = 1; index <= 41; index += 1) {
        const verdict = index % 3 === 0 ? 'IRRELEVANT' : index % 2 === 0 ? 'NO' : 'YES';
        await fixtureTransaction`
          insert into api.messages (
            id,
            game_id,
            player_id,
            sequence_no,
            content,
            status,
            verdict,
            judged_at
          ) values (
            ${randomUUID()},
            ${fixtureGameId},
            ${fixturePlayerId},
            ${index},
            ${`startup fixture question ${index}`},
            'JUDGED',
            ${verdict},
            now()
          )
        `;
      }
    });
    log('created deterministic 41-message startup fixture');

    await worker.reconcileActiveGameProgressSummary(sql);
    const fixtureJobsAfterFirstReconcile = await sql`
      select
        id,
        through_question_count as "throughQuestionCount",
        through_sequence_no as "throughSequenceNo",
        source_fingerprint as "sourceFingerprint",
        status,
        attempt_count as "attemptCount"
      from private.progress_summary_jobs
      where game_id = ${fixtureGameId}
        and through_question_count = 40
    `;
    assert(fixtureJobsAfterFirstReconcile.length === 1, 'startup reconciliation did not create exactly one boundary-40 job');
    assert(Number(fixtureJobsAfterFirstReconcile[0].throughSequenceNo) === 40, 'startup reconciliation did not target the fortieth sequence');
    await worker.reconcileActiveGameProgressSummary(sql);
    const fixtureJobsAfterSecondReconcile = await sql`
      select id, status, attempt_count as "attemptCount"
      from private.progress_summary_jobs
      where game_id = ${fixtureGameId}
        and through_question_count = 40
    `;
    assert(fixtureJobsAfterSecondReconcile.length === 1, 'startup reconciliation duplicated the boundary-40 job');
    assert(fixtureJobsAfterSecondReconcile[0].status === 'PENDING' && Number(fixtureJobsAfterSecondReconcile[0].attemptCount) === 0, 'startup reconciliation changed the pending job');

    const fixtureJob = await worker.claimNextProgressSummary('acceptance-worker', new Date(), { transaction });
    assert(fixtureJob && fixtureJob.gameId === fixtureGameId && fixtureJob.throughQuestionCount === 40, 'worker did not claim the boundary-40 fixture job');
    await worker.processProgressSummary(fixtureJob, { judge, workerId: 'acceptance-worker', sql, transaction });
    const fixtureSummaryRows = await sql`
      select
        generation_status as "generationStatus",
        through_question_count as "throughQuestionCount",
        through_sequence_no as "throughSequenceNo"
      from api.game_progress_summaries
      where game_id = ${fixtureGameId}
    `;
    assert(fixtureSummaryRows[0]?.generationStatus === 'READY', 'boundary-40 fixture summary is not READY');
    assert(Number(fixtureSummaryRows[0].throughQuestionCount) === 40 && Number(fixtureSummaryRows[0].throughSequenceNo) === 40, 'boundary-40 fixture summary target mismatch');

    const fixtureFingerprint = fixtureJobsAfterFirstReconcile[0].sourceFingerprint;
    await sql`
      update private.progress_summary_jobs
      set status = 'BLOCKED',
          attempt_count = 4,
          error_code = 'SCHEMA_INVALID',
          lease_owner = null,
          lease_expires_at = null,
          updated_at = now()
      where id = ${fixtureJob.id}
    `;
    await sql`
      update api.game_progress_summaries
      set generation_status = 'ERROR',
          target_question_count = 40,
          target_sequence_no = 40,
          target_source_fingerprint = ${fixtureFingerprint},
          updated_at = now()
      where game_id = ${fixtureGameId}
    `;
    await worker.reconcileActiveGameProgressSummary(sql);
    const blockedFixtureJobs = await sql`
      select id, status, attempt_count as "attemptCount", source_fingerprint as "sourceFingerprint"
      from private.progress_summary_jobs
      where game_id = ${fixtureGameId}
        and through_question_count = 40
    `;
    assert(blockedFixtureJobs.length === 1, 'blocked boundary-40 restart created a replacement job');
    assert(blockedFixtureJobs[0].id === fixtureJob.id && blockedFixtureJobs[0].status === 'BLOCKED', 'blocked boundary-40 job was replaced or reopened');
    assert(Number(blockedFixtureJobs[0].attemptCount) === 4 && blockedFixtureJobs[0].sourceFingerprint === fixtureFingerprint, 'blocked boundary-40 attempt or fingerprint changed');

    const publicPayload = JSON.stringify(finalSnapshot);
    assert(!publicPayload.includes('acceptance-private-solution-9f0e'), 'private solution leaked through public snapshot');
    assert(!publicPayload.includes('伞柄藏着门票'), 'private key point leaked through public snapshot');
    console.log('first playable loop: PASS (questions, progress summary boundary/challenge refresh/startup backfill/BLOCKED restart, private final answers, atomic success/failure, reveal, cancellation, force-end, privacy)');
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
