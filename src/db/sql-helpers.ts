import type { DbExecutor } from "./executor.js";

export function toPgPlaceholders(sql: string): string {
  let index = 0;
  return sql.replace(/\?/g, () => `$${++index}`);
}

export async function queryRows<T extends Record<string, unknown>>(
  db: DbExecutor,
  sql: string,
  params: readonly unknown[] = [],
): Promise<T[]> {
  return db.queryRows<T>(toPgPlaceholders(sql), params);
}

export async function queryOne<T extends Record<string, unknown>>(
  db: DbExecutor,
  sql: string,
  params: readonly unknown[] = [],
): Promise<T | null> {
  return db.queryOne<T>(toPgPlaceholders(sql), params);
}
