# P25 Instrumentation Readiness Checklist

Use this before shipping rescue telemetry to production dashboards.

## Contract + schema

- [ ] `data/p25_rescue_friction_telemetry_schema.json` is versioned and reviewed.
- [ ] All event names match schema exactly (snake_case, `rescue_*`).
- [ ] Required global properties are present on all emitted events.
- [ ] Enum fields are constrained (`abandon_reason`, `failure_code`, `prep_time_tier`, `household_size_bucket`).

## Stage instrumentation

- [ ] Scan stage emits started/completed/failed/abandoned.
- [ ] Plan stage emits started/generated/accepted/abandoned.
- [ ] Cook stage emits started/step_completed/completed/abandoned.
- [ ] Every stage transition preserves the same `journey_id`.

## Data quality

- [ ] `occurred_at` is ISO timestamp (UTC).
- [ ] `duration_ms` values are non-negative integers.
- [ ] Retry/replay logic avoids duplicate success events per journey stage.
- [ ] Backfill/late events are marked with source flag if applicable.

## KPI readiness

- [ ] Dashboard formulas match KPI mapping in `docs/p25_rescue_friction_telemetry_map.md`.
- [ ] Segment cuts exist for household size and prep-time tier.
- [ ] Stage abandonment reasons are visible in dashboard filters.
- [ ] P50/P90 latency cards are implemented for scan/plan/cook.

## Verification

- [ ] Run: `node scripts/p25-telemetry-spec-lint.js`
- [ ] Capture one end-to-end test journey payload sequence and store with QA notes.
- [ ] Confirm event volume sanity in staging (no event explosion or missing stages).
