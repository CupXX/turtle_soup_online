import postgres, { type Sql, type TransactionSql } from 'postgres';
import { loadWorkerConfig, type WorkerConfig } from '../config.js';

let client: Sql | undefined;

export type WorkerTransaction = <T>(callback: (sql: TransactionSql) => Promise<T>) => Promise<T>;

export function getWorkerDb(config: WorkerConfig = loadWorkerConfig()): Sql {
  if (!client) {
    client = postgres(config.databaseUrl, {
      prepare: false,
      max: 2,
    });
  }
  return client;
}

export function withWorkerTransaction<T>(
  callback: (sql: TransactionSql) => Promise<T>,
  config?: WorkerConfig,
): Promise<T> {
  return getWorkerDb(config).begin(async (transaction) => callback(transaction)) as Promise<T>;
}
