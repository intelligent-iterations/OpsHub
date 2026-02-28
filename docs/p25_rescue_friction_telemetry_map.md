# P25 — Rescue Friction Telemetry Map (Scan → Plan → Cook)

## Purpose
Define an implementable telemetry contract to diagnose friction and drop-off in PantryPal's rescue journey, with segmentation by household size and prep-time tier.

Primary artifact: `data/p25_rescue_friction_telemetry_schema.json`.

## Funnel stages

1. **Scan**: user starts inventory capture and successfully captures at-risk items.
2. **Plan**: user receives a rescue plan and accepts a recipe/action.
3. **Cook**: user starts execution and completes rescue cooking.

Canonical journey key: `journey_id` (UUID per scan→plan→cook attempt).

## Event taxonomy (v1)

| Event | Stage | Type | Why it exists |
|---|---|---|---|
| `rescue_scan_started` | scan | entry | funnel denominator and scan intent |
| `rescue_scan_completed` | scan | success | scan stage success + latency |
| `rescue_scan_failed` | scan | failure | root-cause reliability diagnostics |
| `rescue_scan_abandoned` | scan | abandon | explicit drop-off reason capture |
| `rescue_plan_started` | plan | entry | transition marker from scan → plan |
| `rescue_plan_generated` | plan | milestone | recommendation generation performance |
| `rescue_plan_accepted` | plan | success | plan conversion + recommendation quality |
| `rescue_plan_abandoned` | plan | abandon | plan friction reason capture |
| `rescue_cook_started` | cook | entry | plan-to-execution conversion |
| `rescue_cook_step_completed` | cook | progress | mid-cook friction / pacing |
| `rescue_cook_completed` | cook | success | end-to-end rescue completion |
| `rescue_cook_abandoned` | cook | abandon | execution-stage drop-off reasons |

## Global required properties

Emit on **all** events:

- `event_name`, `event_version`, `occurred_at`
- `user_id`, `household_id`, `session_id`, `journey_id`
- `stage`, `platform`, `app_version`, `entry_point`
- `household_size_bucket` (`1`, `2`, `3-4`, `5+`)
- `prep_time_tier` (`quick_15`, `standard_30`, `extended_45_plus`)

## Friction properties (required where relevant)

- `abandon_reason` enum: `too_busy`, `too_many_steps`, `missing_ingredient`, `time_mismatch`, `app_confusion`, `notification_dismissed`, `technical_issue`, `other`
- `failure_code` enum: `camera_denied`, `ocr_low_confidence`, `network_timeout`, `parse_error`, `unknown`
- `time_in_stage_ms` and stage-specific latency fields:
  - `scan_duration_ms`
  - `generation_duration_ms`
  - `cook_duration_ms`

## Sample payloads

### 1) Scan completed

```json
{
  "event_name": "rescue_scan_completed",
  "event_version": "1.0",
  "occurred_at": "2026-02-28T00:21:11.001Z",
  "user_id": "u_102",
  "household_id": "hh_77",
  "session_id": "s_f9a",
  "journey_id": "j_6c7f0a",
  "stage": "scan",
  "platform": "ios",
  "app_version": "0.25.0",
  "entry_point": "home_scan_cta",
  "household_size_bucket": "3-4",
  "prep_time_tier": "standard_30",
  "scan_method": "barcode",
  "item_count": 8,
  "scan_duration_ms": 24500,
  "at_risk_item_count": 3
}
```

### 2) Plan abandoned

```json
{
  "event_name": "rescue_plan_abandoned",
  "event_version": "1.0",
  "occurred_at": "2026-02-28T00:24:10.331Z",
  "user_id": "u_102",
  "household_id": "hh_77",
  "session_id": "s_f9a",
  "journey_id": "j_6c7f0a",
  "stage": "plan",
  "platform": "ios",
  "app_version": "0.25.0",
  "entry_point": "home_scan_cta",
  "household_size_bucket": "3-4",
  "prep_time_tier": "standard_30",
  "abandon_reason": "time_mismatch",
  "time_in_stage_ms": 54100,
  "candidate_recipe_count": 5,
  "last_filter_state": "max_20_min_only"
}
```

### 3) Cook completed

```json
{
  "event_name": "rescue_cook_completed",
  "event_version": "1.0",
  "occurred_at": "2026-02-28T00:49:10.451Z",
  "user_id": "u_102",
  "household_id": "hh_77",
  "session_id": "s_f9a",
  "journey_id": "j_6c7f0a",
  "stage": "cook",
  "platform": "ios",
  "app_version": "0.25.0",
  "entry_point": "home_scan_cta",
  "household_size_bucket": "3-4",
  "prep_time_tier": "standard_30",
  "selected_recipe_id": "r_1139",
  "cook_duration_ms": 1160000,
  "rescue_item_count": 3,
  "leftover_servings": 2,
  "self_reported_effort": 3
}
```

## KPI mapping

| KPI | Formula | Key cuts |
|---|---|---|
| End-to-end rescue rate | `cook_completed journeys / scan_started journeys` | platform, household_size_bucket, prep_time_tier |
| Scan success rate | `scan_completed / scan_started` | scan_method, permission state |
| Scan→Plan conversion | `journeys with plan_started / journeys with scan_completed` | at_risk_item_count bucket |
| Plan acceptance rate | `plan_accepted / plan_started` | selected_recipe_rank, prep_time_tier |
| Plan→Cook start rate | `cook_started / plan_accepted` | entry_point |
| Cook completion rate | `cook_completed / cook_started` | steps_total bucket |
| Stage abandon rate | `*_abandoned / stage_started` | abandon_reason |
| P90 scan latency | `p90(scan_duration_ms)` | platform, scan_method |
| P90 plan generation latency | `p90(generation_duration_ms)` | recommendation_model_version |
| Median cook duration | `p50(cook_duration_ms)` | household_size_bucket, prep_time_tier |

## Benchmark-informed rationale (research)

Research delegation record: `artifacts/p25-claude-research-notes.md` (generated via Claude Code CLI).

Practical benchmark anchors used for initial targets (validate against PantryPal baseline after week 2):

- Consumer app activation often lands around **15–30%** depending on category and definition.
- Food/Drink app retention tends to decay quickly by D7/D30, reinforcing the need for high early funnel observability.
- Multi-step journeys require explicit abandon events and per-stage latency to isolate friction (scan UX friction vs recommendation mismatch vs execution friction).

References (from delegated research notes):
- Mixpanel funnel analysis guidance: https://mixpanel.com/blog/funnel-analysis/
- Segment naming/tracking-plan guidance: https://segment.com/academy/collecting-data/naming-conventions-for-clean-data/
- Amplitude activation/event guidance: https://amplitude.com/blog/activation-metrics
- Adjust benchmarks hub: https://www.adjust.com/resources/ebooks/mobile-app-trends/
- AppsFlyer reports hub: https://www.appsflyer.com/resources/reports/
- data.ai state of mobile: https://www.data.ai/en/go/state-of-mobile-2024

## Instrumentation rollout plan

1. Implement event emitter wrappers for `scan`, `plan`, `cook` surfaces.
2. Add strict enum guards for `abandon_reason` and `failure_code`.
3. Enforce global required properties in analytics middleware.
4. Validate event schema with `node scripts/p25-telemetry-spec-lint.js`.
5. Complete readiness checklist in `docs/p25_instrumentation_readiness_checklist.md` before enabling production dashboards.
