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
  actionStatus: string | null;
  errorCode: string | null;
  workerHealthy: boolean;
};

export type ForceEndResult = {
  status: 'ENDED';
  endReason: 'FORCE_ENDED';
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

export class BlockedActionRetryError extends Error {
  constructor() {
    super('QUEUE_BLOCKED');
    this.name = 'BlockedActionRetryError';
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
    return { gameId: null, gameStatus: null, extractionStatus: null, actionStatus: null, errorCode: null, workerHealthy: false };
  }

  const [jobs, actions, heartbeats] = await Promise.all([
    sql<Array<{ status: string; errorCode: string | null }>>`
      select jobs.status, jobs.error_code as "errorCode"
      from private.key_point_extraction_jobs jobs
      join private.game_secrets secrets
        on secrets.game_id = jobs.game_id and secrets.input_version = jobs.input_version
      where jobs.game_id = ${game.id}
      order by jobs.input_version desc
      limit 1
    `,
    sql<Array<{ status: string }>>`
      select status
      from private.game_actions
      where game_id = ${game.id}
        and status not in ('COMPLETED', 'CANCELLED')
      order by sequence_no asc
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
    actionStatus: actions[0]?.status ?? null,
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
        (id, game_id, input_version, status, attempt_count, next_attempt_at, created_at, updated_at)
      values (${makeId()}, ${gameId}, 1, 'PENDING', 0, now(), now(), now())
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
  const makeId = idFactory(dependencies);

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
        (id, game_id, input_version, status, attempt_count, next_attempt_at, created_at, updated_at)
      values (${makeId()}, ${validGameId}, ${nextVersion}, 'PENDING', 0, now(), now(), now())
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

export async function retryBlockedAction(
  gameId: string,
  dependencies: LifecycleDependencies = {},
): Promise<void> {
  const validGameId = requireUuid(gameId, 'gameId');

  await runner(dependencies)(async (sql) => {
    await requireFreshWorker(sql);
    const games = await sql<Array<{ id: string; status: string }>>`
      select id, status
      from api.games
      where id = ${validGameId}
      for update
    `;
    const game = games[0];
    if (!game) throw new GameLifecycleStateError('NO_CURRENT_GAME');
    if (game.status !== 'ACTIVE') throw new GameLifecycleStateError('GAME_NOT_ACTIVE');

    const actions = await sql<Array<{ id: string; status: string }>>`
      select id, status
      from private.game_actions
      where game_id = ${validGameId}
        and status = 'BLOCKED'
        and not exists (
          select 1
          from private.game_actions earlier
          where earlier.game_id = private.game_actions.game_id
            and earlier.sequence_no < private.game_actions.sequence_no
            and earlier.status not in ('COMPLETED', 'CANCELLED')
        )
      order by sequence_no asc
      limit 1
      for update
    `;
    const action = actions[0];
    if (!action) throw new BlockedActionRetryError();

    await sql`
      update private.game_actions
      set status = 'RETRY',
          next_attempt_at = now(),
          lease_owner = null,
          lease_expires_at = null,
          error_code = null,
          updated_at = now()
      where id = ${action.id}
        and status = 'BLOCKED'
    `;
  });
}

export async function forceEndGame(
  gameId: string,
  dependencies: LifecycleDependencies = {},
): Promise<ForceEndResult> {
  const validGameId = requireUuid(gameId, 'gameId');
  const makeId = idFactory(dependencies);

  return runner(dependencies)(async (sql) => {
    // Lock incomplete actions before the game row. Worker completion locks the
    // action first and then the game, so this ordering makes the race wait
    // instead of deadlocking.
    await sql`
      select id
      from private.game_actions
      where game_id = ${validGameId}
        and status not in ('COMPLETED', 'CANCELLED')
      order by sequence_no asc
      for update
    `;
    const games = await sql<Array<{ id: string; status: string }>>`
      select id, status
      from api.games
      where id = ${validGameId}
      for update
    `;
    const game = games[0];
    if (!game) throw new GameLifecycleStateError('NO_CURRENT_GAME');
    if (game.status !== 'ACTIVE') throw new GameLifecycleStateError('GAME_NOT_ACTIVE');

    const [secrets, keyPoints, sequences] = await Promise.all([
      sql<Array<{ fullSolution: string }>>`
        select full_solution as "fullSolution"
        from private.game_secrets
        where game_id = ${validGameId}
        order by input_version desc
        limit 1
      `,
      sql<Array<{ ordinal: number; content: string }>>`
        select ordinal, content
        from private.key_points
        where game_id = ${validGameId}
        order by ordinal asc
      `,
      sql<Array<{ sequenceNo: number | string }>>`
        select coalesce(max(sequence_no), 0) as "sequenceNo"
        from private.game_actions
        where game_id = ${validGameId}
      `,
    ]);
    const secret = secrets[0];
    if (!secret || keyPoints.length < 3) throw new GameLifecycleStateError('NO_CURRENT_GAME');
    const sequenceNo = Number(sequences[0]?.sequenceNo ?? 0) + 1;
    const eventId = makeId();

    await sql`
      insert into api.game_events
        (id, game_id, sequence_no, event_type, player_id, awarded_points, created_at)
      values
        (${eventId}, ${validGameId}, ${sequenceNo}, 'FORCE_ENDED', null, 0, now())
      on conflict (game_id, sequence_no) do nothing
    `;
    await sql`
      insert into api.game_reveals (game_id, full_solution, revealed_at)
      values (${validGameId}, ${secret.fullSolution}, now())
      on conflict (game_id) do nothing
    `;
    for (const point of keyPoints) {
      await sql`
        insert into api.revealed_key_points (game_id, ordinal, content)
        values (${validGameId}, ${point.ordinal}, ${point.content})
        on conflict (game_id, ordinal) do nothing
      `;
    }
    await sql`
      update api.games
      set status = 'ENDED',
          end_reason = 'FORCE_ENDED',
          winner_player_id = null,
          ended_at = now(),
          updated_at = now()
      where id = ${validGameId}
        and status = 'ACTIVE'
    `;
    await sql`
      update api.messages
      set status = 'CANCELLED',
          updated_at = now()
      where id in (
        select result_resource_id
        from private.game_actions
        where game_id = ${validGameId}
          and action_type = 'NORMAL_MESSAGE'
          and status not in ('COMPLETED', 'CANCELLED')
      )
        and status = 'PENDING'
    `;
    await sql`
      update private.final_answer_submissions
      set status = 'CANCELLED',
          judged_at = now()
      where game_id = ${validGameId}
        and status not in ('COMPLETED', 'CANCELLED')
    `;
    await sql`
      update private.game_actions
      set status = 'CANCELLED',
          lease_owner = null,
          lease_expires_at = null,
          error_code = null,
          updated_at = now()
      where game_id = ${validGameId}
        and status not in ('COMPLETED', 'CANCELLED')
    `;

    return { status: 'ENDED', endReason: 'FORCE_ENDED' };
  });
}
