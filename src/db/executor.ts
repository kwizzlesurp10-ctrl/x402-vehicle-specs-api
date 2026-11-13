import postgres from "postgres";

export type DbExecutor = {
  queryRows<T extends Record<string, unknown>>(
    text: string,
    params?: readonly unknown[],
  ): Promise<T[]>;
  queryOne<T extends Record<string, unknown>>(
    text: string,
    params?: readonly unknown[],
  ): Promise<T | null>;
  exec(text: string): Promise<void>;
  close(): Promise<void>;
};

class PostgresExecutor implements DbExecutor {
  constructor(private readonly sql: postgres.Sql) {}

  async queryRows<T extends Record<string, unknown>>(
    text: string,
    params: readonly unknown[] = [],
  ): Promise<T[]> {
    return (await this.sql.unsafe(text, params as never[])) as T[];
  }

  async queryOne<T extends Record<string, unknown>>(
    text: string,
    params: readonly unknown[] = [],
  ): Promise<T | null> {
    const rows = await this.queryRows<T>(text, params);
    return rows[0] ?? null;
  }

  async exec(text: string): Promise<void> {
    await this.sql.unsafe(text);
  }

  async close(): Promise<void> {
    await this.sql.end({ timeout: 5 });
  }
}

export function createExecutorFromUrl(connectionString: string): DbExecutor {
  const sql = postgres(connectionString, {
    max: 5,
    idle_timeout: 20,
    connect_timeout: 30,
    prepare: false,
  });
  return new PostgresExecutor(sql);
}
