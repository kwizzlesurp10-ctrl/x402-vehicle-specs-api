import type { DbExecutor } from "../db/executor.js";
import type { VehicleRow } from "../db/client.js";

export class VehicleRepository {
  constructor(private readonly db: DbExecutor) {}

  async getById(id: number): Promise<VehicleRow | null> {
    return this.db.queryOne<VehicleRow>(`SELECT * FROM vehicles WHERE id = $1`, [
      id,
    ]);
  }

  async search(params: {
    year?: number;
    make?: string;
    model?: string;
    limit: number;
  }): Promise<VehicleRow[]> {
    const clauses: string[] = [];
    const args: unknown[] = [];
    let n = 1;

    if (params.year !== undefined) {
      clauses.push(`year = $${n++}`);
      args.push(params.year);
    }
    if (params.make !== undefined) {
      clauses.push(`search_make = $${n++}`);
      args.push(params.make.trim().toLowerCase());
    }
    if (params.model !== undefined) {
      clauses.push(`search_model LIKE $${n++}`);
      args.push(`%${params.model.trim().toLowerCase()}%`);
    }

    const where = clauses.length > 0 ? `WHERE ${clauses.join(" AND ")}` : "";
    const sql = `SELECT * FROM vehicles ${where} ORDER BY year DESC, make, model LIMIT $${n}`;
    args.push(params.limit);
    return this.db.queryRows<VehicleRow>(sql, args);
  }

  async listMakes(year: number): Promise<string[]> {
    const rows = await this.db.queryRows<{ make: string }>(
      `SELECT DISTINCT make FROM vehicles WHERE year = $1 ORDER BY make`,
      [year],
    );
    return rows.map((r) => r.make);
  }

  async listModels(year: number, make: string): Promise<string[]> {
    const rows = await this.db.queryRows<{ model: string }>(
      `SELECT DISTINCT model FROM vehicles
       WHERE year = $1 AND search_make = $2
       ORDER BY model`,
      [year, make.trim().toLowerCase()],
    );
    return rows.map((r) => r.model);
  }

  async getMany(ids: number[]): Promise<VehicleRow[]> {
    if (ids.length === 0) return [];
    const placeholders = ids.map((_, i) => `$${i + 1}`).join(",");
    return this.db.queryRows<VehicleRow>(
      `SELECT * FROM vehicles WHERE id IN (${placeholders})`,
      ids,
    );
  }

  async statsByYearAndClass(
    year: number,
    vehicleClass: string,
  ): Promise<{
    count: number;
    avg_city_mpg: number | null;
    avg_highway_mpg: number | null;
    avg_combined_mpg: number | null;
    avg_displacement_l: number | null;
    engine_mix: Array<{ cylinders: number | null; count: number }>;
  }> {
    const summary = await this.db.queryOne<{
      count: number;
      avg_city_mpg: number | null;
      avg_highway_mpg: number | null;
      avg_combined_mpg: number | null;
      avg_displacement_l: number | null;
    }>(
      `SELECT
          COUNT(*)::int AS count,
          AVG(city_mpg) AS avg_city_mpg,
          AVG(highway_mpg) AS avg_highway_mpg,
          AVG(combined_mpg) AS avg_combined_mpg,
          AVG(displ) AS avg_displacement_l
         FROM vehicles
         WHERE year = $1 AND v_class = $2`,
      [year, vehicleClass],
    );

    const engineMix = await this.db.queryRows<{
      cylinders: number | null;
      count: number;
    }>(
      `SELECT cylinders, COUNT(*)::int AS count
         FROM vehicles WHERE year = $1 AND v_class = $2
         GROUP BY cylinders ORDER BY count DESC LIMIT 12`,
      [year, vehicleClass],
    );

    return {
      count: summary?.count ?? 0,
      avg_city_mpg: summary?.avg_city_mpg ?? null,
      avg_highway_mpg: summary?.avg_highway_mpg ?? null,
      avg_combined_mpg: summary?.avg_combined_mpg ?? null,
      avg_displacement_l: summary?.avg_displacement_l ?? null,
      engine_mix: engineMix,
    };
  }
}
