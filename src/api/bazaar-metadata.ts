import { declareDiscoveryExtension } from "@x402/extensions/bazaar";

const vehicleRecordExample = {
  id: 25262,
  year: 2009,
  make: "Volkswagen",
  model: "Jetta",
  mpg: { city: 29, highway: 40, combined: 32 },
  meta: { source: "EPA FuelEconomy.gov", updated_at: "2026-01-01T00:00:00.000Z" },
};

export const bazaarVehicleSearch = declareDiscoveryExtension({
  input: { year: 2009, make: "Volkswagen", limit: 25 },
  inputSchema: {
    type: "object",
    properties: {
      year: { type: "integer", description: "Model year (1984+)" },
      make: { type: "string" },
      model: { type: "string" },
      limit: { type: "integer", minimum: 1, maximum: 100 },
    },
  },
  output: {
    example: {
      query: { year: 2009, make: "Volkswagen", model: null },
      count: 1,
      vehicles: [vehicleRecordExample],
      meta: vehicleRecordExample.meta,
    },
  },
});

export const bazaarVehicleById = declareDiscoveryExtension({
  pathParams: { id: 25262 },
  pathParamsSchema: {
    type: "object",
    properties: {
      id: { type: "integer", description: "EPA FuelEconomy.gov vehicle id" },
    },
    required: ["id"],
  },
  output: {
    example: {
      vehicle: vehicleRecordExample,
      meta: vehicleRecordExample.meta,
    },
  },
});

export const bazaarVehicleEmissions = declareDiscoveryExtension({
  pathParams: { id: 25262 },
  pathParamsSchema: {
    type: "object",
    properties: { id: { type: "integer" } },
    required: ["id"],
  },
  output: {
    example: {
      id: 25262,
      year: 2009,
      make: "Volkswagen",
      model: "Jetta",
      emissions: { score: null, smog: null },
      missing_fields_notes: [],
      meta: vehicleRecordExample.meta,
    },
  },
});

export const bazaarCompare = declareDiscoveryExtension({
  input: { ids: "25262,25263" },
  inputSchema: {
    type: "object",
    properties: {
      ids: {
        type: "string",
        description: "Comma-separated EPA vehicle ids (1–5)",
      },
    },
    required: ["ids"],
  },
  output: {
    example: {
      requested_ids: [25262, 25263],
      found_count: 2,
      vehicles: [{ ...vehicleRecordExample }, { id: 25263, found: false }],
      meta: vehicleRecordExample.meta,
    },
  },
});

export const bazaarStats = declareDiscoveryExtension({
  input: { year: 2009, class: "Midsize Cars" },
  inputSchema: {
    type: "object",
    properties: {
      year: { type: "integer" },
      class: { type: "string", description: "EPA vehicle class label" },
    },
    required: ["year", "class"],
  },
  output: {
    example: {
      year: 2009,
      vehicle_class: "Midsize Cars",
      stats: {
        count: 120,
        avg_city_mpg: 22.1,
        avg_highway_mpg: 30.4,
        avg_combined_mpg: 25.2,
        avg_displacement_l: 2.4,
        engine_mix: { gasoline: 0.9, hybrid: 0.1 },
      },
      meta: vehicleRecordExample.meta,
    },
  },
});

export const bazaarPostJob = declareDiscoveryExtension({
  input: {
    type: "starter_kit",
    depth: "standard",
    input: { language: "typescript" },
  },
  inputSchema: {
    type: "object",
    properties: {
      type: {
        type: "string",
        enum: [
          "fleet_analysis",
          "comparison_report",
          "trend_insights",
          "custom_export",
          "starter_kit",
        ],
      },
      depth: { type: "string", enum: ["standard", "deep"] },
      webhook_url: { type: "string" },
      input: { type: "object" },
    },
    required: ["type", "input"],
  },
  bodyType: "json",
  output: {
    example: {
      job_id: "550e8400-e29b-41d4-a716-446655440000",
      status: "queued",
      type: "starter_kit",
      depth: "standard",
      payment_usd: 0.25,
      poll_token: "<secret>",
      poll_url:
        "/v1/jobs/550e8400-e29b-41d4-a716-446655440000?poll_token=<secret>",
    },
  },
});