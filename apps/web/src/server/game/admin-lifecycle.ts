import { randomUUID } from 'node:crypto';
import type { Sql, TransactionSql } from 'postgres';
import { normalizeBoundedText, requireUuid } from '@/server/security/input';
import { withWebTransaction } from '@/server/db/client';

export type AdminPuzzleInput = {
  puzzleSurface: string;
  fullSolution: string;
};

export type ActivateGameInput = {
  gameId: string;
  inputVersion: number;
  keyPoints: Array<{ content: string }>;
};

export type LifecycleDependencies = {
  transaction?: <T>(callback: (sql: TransactionSql) => Promise<T>) => Promise<T>;
  idFactory?: () => string;
};

export type AdminStatus = {
  gameId: string | null;
  gameStatus: 'WAITING' | 'ACTIVE' | 'ENDED' | null;
  extractionStatus: string | null;
  errorCode: string | null;
  workerHealthy: boolean;
};

export class GameAlreadyOpenError extends Error {
  constructor() {
    super('GAME_ALREADY_ACTIVE');
    this.name = 'GameAlreadyOpenError';
  }
}

export class GameLifecycleStateError extends Error {
  constructor(message = 'GAME_NOT_ACTIVE') {
    super(message);
    this.name = 'GameLifecycleStateError';
  }
}

export class InputVersionConflictError extends Error {
  constructor() {
    super('INPUT_VERSION_CONFLICT');
    this.name = 'InputVersionConflictError';
  }
}

export class ExtractionRetryError extends Error {
  constructor() {
    super('JUDGE_UNAVAILABLE');
    this.name = 'ExtractionRetryError';
  }
}

export class WorkerUnavailableError extends Error {
  constructor() {
    super('JUDGE_UNAVAILABLE');
    this.name = 'WorkerUnavailableError';
  }
}

type GameRow = {
  status: string;
  puzzleSurface: string | null;
  inputVersion: number;
};

type TransactionRunner = <T>(callback: (sql: TransactionSql) => Promise<T>) => Promise<T>;

function isWorkerHealthy(lastSeenAt: string | null | undefined, now = Date.now()): boolean {
  const timestamp = lastSeenAt ? new Date(lastSeenAt).getTime() : 0;
  return timestamp > 0 && now - timestamp <= 30_000;
}

async function requireFreshWorker(sql: TransactionSql): Promise<void> {
  const heartbeats = await sql<Array<{ lastSeenAt: string }>>`
    select last_seen_at as "lastSeenAt"
    from private.worker_heartbeats
    order by last_seen_at desc
    limit 1
  `;
  if (!isWorkerHealthy(heartbeats[0]?.lastSeenAt)) {
    throw new WorkerUnavailableError();
  }
}

function runner(dependencies: LifecycleDependencies): TransactionRunner {
  return dependencies.transaction ?? withWebTransaction;
}

function idFactory(dependencies: LifecycleDependencies): () => string {
  return dependencies.idFactory ?? randomUUID;
}

export async function getAdminStatus(sql: Sql): Promise<AdminStatus> {
  const games = await sql<Array<{ id: string; gameStatus: AdminStatus['gameStatus'] }>>`
    select id, status as "gameStatus"
    from api.games
    order by case when status in ('WAITING', 'ACTIVE') then 0 else 1 end,
             coalesce(ended_at, updated_at) desc
    limit 1
  `;
  const game = games[0];
  if (!game) {
    return { gameId: null, gameStatus: null, extractionStatus: null, errorCode: null, workerHealthy: false };
  }

  const [jobs, heartbeats] = await Promise.all([
    sql<Array<{ status: string; errorCode: string | null }>>`
      select jobs.status, jobs.error_code as "errorCode"
      from private.key_point_extraction_jobs jobs
      join private.game_secrets secrets
        on secrets.game_id = jobs.game_id and secrets.input_version = jobs.input_version
      where jobs.game_id = ${game.id}
      order by jobs.input_version desc
      limit 1
    `,
    sql<Array<{ lastSeenAt: string }>>`
      select last_seen_at as "lastSeenAt"
      from private.worker_heartbeats
      order by last_seen_at desc
      limit 1
    `,
  ]);
  const workerHealthy = isWorkerHealthy(heartbeats[0]?.lastSeenAt);
  return {
    gameId: game.id,
    gameStatus: game.gameStatus,
    extractionStatus: jobs[0]?.status ?? null,
    errorCode: jobs[0]?.errorCode ?? null,
    workerHealthy,
  };
}

export async function getCurrentAdminGameId(sql: Sql): Promise<string | null> {
  const rows = await sql<Array<{ id: string }>>`
    select id
    from api.games
    where status in ('WAITING', 'ACTIVE')
    order by created_at desc
    limit 1
  `;
  return rows[0]?.id ?? null;
}

function normalizePuzzleInput(input: AdminPuzzleInput): AdminPuzzleInput {
  return {
    puzzleSurface: normalizeBoundedText(input.puzzleSurface, 2000, 'puzzleSurface'),
    fullSolution: normalizeBoundedText(input.fullSolution, 8000, 'fullSolution'),
  };
}

function normalizeKeyPoints(keyPoints: ActivateGameInput['keyPoints']): string[] {
  if (keyPoints.length < 3 || keyPoints.length > 5) {
    throw new Error('key points must contain three to five items');
  }

  const contents = keyPoints.map((point) => normalizeBoundedText(point.content, 2000, 'keyPoint'));
  const normalized = contents.map((content) => content.normalize('NFKC').toLocaleLowerCase('zh-CN'));
  if (new Set(normalized).size !== normalized.length) {
    throw new Error('key points must be unique');
  }
  return contents;
}

export async function createPreparation(
  rawInput: AdminPuzzleInput,
  dependencies: LifecycleDependencies = {},
): Promise<{ gameId: string; status: 'WAITING' }> {
  const input = normalizePuzzleInput(rawInput);
  const makeId = idFactory(dependencies);

  return runner(dependencies)(async (sql) => {
    await requireFreshWorker(sql);
    const openGames = await sql<Array<{ id: string }>>`
      select id
      from api.games
      where status in ('WAITING', 'ACTIVE')
      order by created_at desc
      limit 1
      for update
    `;
    if (openGames[0]) throw new GameAlreadyOpenError();

    const gameId = makeId();
    await sql`
      insert into api.games
        (id, status, puzzle_surface, key_point_total, discovered_key_point_count,
         total_question_count, created_at, activated_at, ended_at, updated_at)
      values
        (${gameId}, 'WAITING', null, 0, 0, 0, now(), null, null, now())
    `;
    await sql`
      insert into private.game_secrets
        (game_id, puzzle_surface, full_solution, input_version, updated_at)
      values (${gameId}, ${input.puzzleSurface}, ${input.fullSolution}, 1, now())
    `;
    await sql`
      insert into private.key_point_extraction_jobs
        (game_id, input_version, status, attempt_count, next_attempt_at, created_at, updated_at)
      values (${gameId}, 1, 'PENDING', 0, now(), now(), now())
    `;

    return { gameId, status: 'WAITING' };
  });
}

export async function replacePreparation(
  gameId: string,
  rawInput: AdminPuzzleInput,
  dependencies: LifecycleDependencies = {},
): Promise<void> {
  const validGameId = requireUuid(gameId, 'gameId');
  const input = normalizePuzzleInput(rawInput);

  await runner(dependencies)(async (sql) => {
    await requireFreshWorker(sql);
    const games = await sql<Array<{ status: string }>>`
      select status
      from api.games
      where id = ${validGameId}
      for update
    `;
    const game = games[0];
    if (!game) throw new GameLifecycleStateError('NO_CURRENT_GAME');
    if (game.status !== 'WAITING') throw new GameLifecycleStateError('GAME_NOT_ACTIVE');

    const secrets = await sql<Array<{ inputVersion: number }>>`
      select input_version as "inputVersion"
      from private.game_secrets
      where game_id = ${validGameId}
      for update
    `;
    const current = secrets[0];
    if (!current) throw new GameLifecycleStateError('NO_CURRENT_GAME');
    const nextVersion = current.inputVersion + 1;

    await sql`
      update private.game_secrets
      set puzzle_surface = ${input.puzzleSurface},
          full_solution = ${input.fullSolution},
          input_version = ${nextVersion},
          updated_at = now()
      where game_id = ${validGameId}
    `;
    await sql`
      insert into private.key_point_extraction_jobs
        (game_id, input_version, status, attempt_count, next_attempt_at, created_at, updated_at)
      values (${validGameId}, ${nextVersion}, 'PENDING', 0, now(), now(), now())
      on conflict (game_id, input_version) do nothing
    `;
  });
}

export async function retryExtraction(
  gameId: string,
  dependencies: LifecycleDependencies = {},
): Promise<void> {
  const validGameId = requireUuid(gameId, 'gameId');

  await runner(dependencies)(async (sql) => {
    await requireFreshWorker(sql);
    const secrets = await sql<Array<{ inputVersion: number }>>`
      select input_version as "inputVersion"
      from private.game_secrets
      where game_id = ${validGameId}
      for update
    `;
    const secret = secrets[0];
    if (!secret) throw new GameLifecycleStateError('NO_CURRENT_GAME');

    const jobs = await sql<Array<{ status: string }>>`
      select status
      from private.key_point_extraction_jobs
      where game_id = ${validGameId} and input_version = ${secret.inputVersion}
      for update
    `;
    if (jobs[0]?.status !== 'BLOCKED') throw new ExtractionRetryError();

    await sql`
      update private.key_point_extraction_jobs
      set status = 'RETRY',
          next_attempt_at = now(),
          lease_owner = null,
          lease_expires_at = null,
          error_code = null,
          updated_at = now()
      where game_id = ${validGameId}
        and input_version = ${secret.inputVersion}
        and status = 'BLOCKED'
    `;
  });
}

export async function activateGame(
  input: ActivateGameInput,
  dependencies: LifecycleDependencies = {},
): Promise<void> {
  const gameId = requireUuid(input.gameId, 'gameId');
  if (!Number.isInteger(input.inputVersion) || input.inputVersion < 1) {
    throw new InputVersionConflictError();
  }
  const keyPoints = normalizeKeyPoints(input.keyPoints);
  const makeId = idFactory(dependencies);

  await runner(dependencies)(async (sql) => {
    const rows = await sql<GameRow[]>`
      select
        games.status,
        secrets.puzzle_surface as "puzzleSurface",
        secrets.input_version as "inputVersion"
      from api.games games
      join private.game_secrets secrets on secrets.game_id = games.id
      where games.id = ${gameId}
      for update
    `;
    const game = rows[0];
    if (!game) throw new GameLifecycleStateError('NO_CURRENT_GAME');
    if (game.status !== 'WAITING') throw new GameLifecycleStateError('GAME_ALREADY_ACTIVE');
    if (game.inputVersion !== input.inputVersion) throw new InputVersionConflictError();
    if (!game.puzzleSurface) throw new GameLifecycleStateError('NO_CURRENT_GAME');

    for (const [index, content] of keyPoints.entries()) {
      await sql`
        insert into private.key_points
          (id, game_id, ordinal, content, created_at)
        values (${makeId()}, ${gameId}, ${index + 1}, ${content}, now())
      `;
    }
    await sql`
      update api.games
      set status = 'ACTIVE',
          puzzle_surface = ${game.puzzleSurface},
          key_point_total = ${keyPoints.length},
          discovered_key_point_count = 0,
          activated_at = now(),
          updated_at = now()
      where id = ${gameId} and status = 'WAITING'
    `;
    await sql`
      update private.key_point_extraction_jobs
      set status = 'COMPLETED', updated_at = now()
      where game_id = ${gameId} and input_version = ${input.inputVersion}
    `;
  });
}
