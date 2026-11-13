import { PGlite } from "@electric-sql/pglite";
import type { DbExecutor } from "./executor.js";

class PgliteExecutor implements DbExecutor {
  constructor(private readonly pg: PGlite) {}

  async queryRows<T extends Record<string, unknown>>(
    text: string,
    params: readonly unknown[] = [],
  ): Promise<T[]> {
    const result = await this.pg.query(text, [...params]);
    return result.rows as T[];
  }

  async queryOne<T extends Record<string, unknown>>(
    text: string,
    params: readonly unknown[] = [],
  ): Promise<T | null> {
    const rows = await this.queryRows<T>(text, params);
    return rows[0] ?? null;
  }

  async exec(text: string): Promise<void> {
    await this.pg.exec(text);
  }

  async close(): Promise<void> {
    await this.pg.close();
  }
}

export async function createPgliteExecutor(
  migrationSql: string,
): Promise<DbExecutor> {
  const pg = new PGlite();
  await pg.exec(migrationSql);
  return new PgliteExecutor(pg);
}
