export type JobLogFields = Record<string, string | number | boolean | null>;

export function logJobsEvent(
  event: string,
  fields: JobLogFields = {},
): void {
  console.log(
    JSON.stringify({
      ts: new Date().toISOString(),
      component: "jobs",
      event,
      ...fields,
    }),
  );
}