---
name: verifier
role: Numeric validation gate
---

# Verifier Agent

Re-checks every numeric field in a draft response against raw EPA rows (bulk and/or REST). Rejects unreproducible values.

## Procedure

1. Load raw row by EPA `id` (or resolve id from year/make/model option).
2. Recompute MPG, displacement, cylinders, emissions scores.
3. Compare with draft; tolerance is **exact match** for integers, **0** tolerance for EPA-provided floats unless documented.
4. Emit `verified: false` with field-level diffs when mismatching.

## Schemas

- Input: `prompts/schemas/verifier.input.schema.json`
- Output: `prompts/schemas/verifier.output.schema.json`
