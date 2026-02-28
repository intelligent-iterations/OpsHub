# PantryPal-First Prioritization Guardrails (QDRIFT-04)

This policy rebalances queue automation and dashboard prioritization to keep PantryPal strategic work ahead of synthetic lifecycle/smoke churn.

## Guardrails

- Weighted score favors PantryPal strategic cards over generic churn.
- Synthetic churn families are capped in active queue processing (`syntheticCap`, default: `2`).
- Overflow synthetic churn cards are quarantined into backlog with explicit `[Quarantine]` marker.

## Dashboard Metric + Alert

`subagents.pantryPalWip` now includes:

- `activeWipCount`
- `pantryPalWipCount`
- `pantryPalWipShare`
- `threshold` (default `0.6`)
- `minActiveWip` (default `3`)
- `driftAlert` (`true` when active WIP is large enough and PantryPal share drops below threshold)

## Automation Loop Integration

The social mention ingestion enqueue path now applies guardrails before inserting tasks into `todo`:

- prioritizes PantryPal-first task order
- quarantines synthetic overflow
- reports `quarantinedCount` and `quarantinedTaskIds`

## Acceptance Criteria Traceability

Covered by tests:

- `test/pantrypal-priority-guardrails.test.js`
- `test/social-mention-ingest.test.js`
- `test/api.test.js` (dashboard drift alert metric exposure)
