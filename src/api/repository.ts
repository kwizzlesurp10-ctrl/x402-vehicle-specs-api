import type Database from "better-sqlite3";
import type { VehicleRow } from "../db/client.js";

export class VehicleRepository {
  constructor(private readonly db: Database.Database) {}

  getById(id: number): VehicleRow | null {
    const row = this.db
      .prepare(`SELECT * FROM vehicles WHERE id = ?`)
      .get(id) as VehicleRow | undefined;
    return row ?? null;
  }

  search(params: {
    year?: number;
    make?: string;
    model?: string;
    limit: number;
  }): VehicleRow[] {
    const clauses: string[] = [];
    const args: Array<string | number> = [];

    if (params.year !== undefined) {
      clauses.push("year = ?");
      args.push(params.year);
    }
    if (params.make !== undefined) {
      clauses.push("search_make = ?");
      args.push(params.make.trim().toLowerCase());
    }
    if (params.model !== undefined) {
      clauses.push("search_model LIKE ?");
      args.push(`%${params.model.trim().toLowerCase()}%`);
    }

    const where = clauses.length > 0 ? `WHERE ${clauses.join(" AND ")}` : "";
    const sql = `SELECT * FROM vehicles ${where} ORDER BY year DESC, make, model LIMIT ?`;
    args.push(params.limit);
    return this.db.prepare(sql).all(...args) as VehicleRow[];
  }

  listMakes(year: number): string[] {
    const rows = this.db
      .prepare(
        `SELECT DISTINCT make FROM vehicles WHERE year = ? ORDER BY make COLLATE NOCASE`,
      )
      .all(year) as Array<{ make: string }>;
    return rows.map((r) => r.make);
  }

  listModels(year: number, make: string): string[] {
    const rows = this.db
      .prepare(
        `SELECT DISTINCT model FROM vehicles
         WHERE year = ? AND search_make = ?
         ORDER BY model COLLATE NOCASE`,
      )
      .all(year, make.trim().toLowerCase()) as Array<{ model: string }>;
    return rows.map((r) => r.model);
  }

  getMany(ids: number[]): VehicleRow[] {
    if (ids.length === 0) return [];
    const placeholders = ids.map(() => "?").join(",");
    return this.db
      .prepare(`SELECT * FROM vehicles WHERE id IN (${placeholders})`)
      .all(...ids) as VehicleRow[];
  }

  statsByYearAndClass(year: number, vehicleClass: string): {
    count: number;
    avg_city_mpg: number | null;
    avg_highway_mpg: number | null;
    avg_combined_mpg: number | null;
    avg_displacement_l: number | null;
    engine_mix: Array<{ cylinders: number | null; count: number }>;
  } {
    const summary = this.db
      .prepare(
        `SELECT
          COUNT(*) AS count,
          AVG(city_mpg) AS avg_city_mpg,
          AVG(highway_mpg) AS avg_highway_mpg,
          AVG(combined_mpg) AS avg_combined_mpg,
          AVG(displ) AS avg_displacement_l
         FROM vehicles
         WHERE year = ? AND v_class = ?`,
      )
      .get(year, vehicleClass) as {
      count: number;
      avg_city_mpg: number | null;
      avg_highway_mpg: number | null;
      avg_combined_mpg: number | null;
      avg_displacement_l: number | null;
    };

    const engineMix = this.db
      .prepare(
        `SELECT cylinders, COUNT(*) AS count
         FROM vehicles WHERE year = ? AND v_class = ?
         GROUP BY cylinders ORDER BY count DESC LIMIT 12`,
      )
      .all(year, vehicleClass) as Array<{ cylinders: number | null; count: number }>;

    return { ...summary, engine_mix: engineMix };
  }
}
