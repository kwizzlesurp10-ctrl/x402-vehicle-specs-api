import type { DbExecutor } from "../../db/executor.js";
import type { VehicleRow } from "../../db/client.js";
import { queryOne } from "../../db/sql-helpers.js";

export type VerifiedField = {
  field: string;
  value: number | string | null;
  raw_value: number | string | null;
  ok: boolean;
};

export type VerifierOutcome = {
  verified: boolean;
  fields: VerifiedField[];
};

function co2ForRow(row: VehicleRow): number | null {
  return row.co2_g_per_mi ?? row.co2_tailpipe_g_per_mi;
}

export async function verifyVehicleFacts(
  db: DbExecutor,
  claims: Array<{
    vehicle_id: number;
    combined_mpg?: number | null;
    co2_g_per_mi?: number | null;
  }>,
): Promise<VerifierOutcome> {
  const fields: VerifiedField[] = [];

  for (const claim of claims) {
    const row = await queryOne<VehicleRow>(
      db,
      `SELECT * FROM vehicles WHERE id = ?`,
      [claim.vehicle_id],
    );

    if (!row) {
      fields.push({
        field: `vehicle_id:${claim.vehicle_id}`,
        value: null,
        raw_value: null,
        ok: false,
      });
      continue;
    }

    if (claim.combined_mpg !== undefined) {
      fields.push({
        field: `combined_mpg:${claim.vehicle_id}`,
        value: claim.combined_mpg,
        raw_value: row.combined_mpg,
        ok: claim.combined_mpg === row.combined_mpg,
      });
    }

    if (claim.co2_g_per_mi !== undefined) {
      const rawCo2 = co2ForRow(row);
      fields.push({
        field: `co2_g_per_mi:${claim.vehicle_id}`,
        value: claim.co2_g_per_mi,
        raw_value: rawCo2,
        ok: claim.co2_g_per_mi === rawCo2,
      });
    }
  }

  return {
    verified: fields.every((f) => f.ok),
    fields,
  };
}
