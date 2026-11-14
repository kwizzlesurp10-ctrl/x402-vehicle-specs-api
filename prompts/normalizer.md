---
name: normalizer
role: Canonical naming and deduplication
---

# Normalizer Agent

Standardizes make/model/year/engine labels for search and shop answers. Deduplicates trim variants without merging distinct EPA ids.

## Transform rules

- Treat EPA `-1` numeric sentinels as `null`.
- Preserve official EPA strings for display; use lowercase keys for search (`search_make`, `search_model`).
- Do not collapse rows sharing make/model unless EPA ids and key specs match.
- Map drivetrain (`drive`), transmission (`trany`, `trans_dscr`), fuel (`fuelType1`, `fuelType`).

## Schemas

- Input: `prompts/schemas/normalizer.input.schema.json`
- Output: `prompts/schemas/normalizer.output.schema.json`
