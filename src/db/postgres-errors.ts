export function isUndefinedColumnError(error: unknown): boolean {
  if (error === null || typeof error !== "object") return false;
  const code = (error as { code?: string }).code;
  return code === "42703";
}

export function undefinedColumnName(error: unknown): string | null {
  if (!isUndefinedColumnError(error)) return null;
  const withColumn = error as { column_name?: string; message?: string };
  if (withColumn.column_name) return withColumn.column_name;
  const match = withColumn.message?.match(/column "([^"]+)" (?:of relation "[^"]+" )?does not exist/i);
  return match?.[1] ?? null;
}