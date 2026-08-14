import postgres, { type Sql, type TransactionSql } from 'postgres';
import { getServerEnv } from '../env.js';

let client: Sql | undefined;

export type { TransactionSql };

export function getDb(): Sql {
  if (!client) {
    const env = getServerEnv();
    client = postgres(env.gameWebDatabaseUrl, {
      prepare: false,
      max: 5,
    });
  }

  return client;
}

export async function withWebTransaction<T>(
  fn: (sql: TransactionSql) => Promise<T>,
): Promise<T> {
  const result = await getDb().begin(async (transaction) => fn(transaction));
  return result as T;
}
