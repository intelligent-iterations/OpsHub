# Paywall Sequential-Testing Safety Checker

## Purpose

`OpsHub/scripts/paywall-sequential-check.js` enforces a lightweight safety policy for paywall experiments that are analyzed multiple times before completion.

The checker is designed to catch common sequential-testing mistakes that inflate false positives:
- repeated peeking
- unbounded alpha spending
- out-of-order or inconsistent cumulative metrics
- winner declarations without boundary crossing

## Policy (Default)

Default policy values:

- `alphaBudget`: `0.05`
- `minLookIntervalHours`: `24`
- `maxLooksPerWeek`: `7`
- `minCumulativeVisitors`: `200`

A run is marked **fail** when any error-level violation is found.

## Input Contract

Input JSON shape:

```json
{
  "experimentId": "paywall-sequential-001",
  "analysisWindow": {
    "startedAt": "2026-02-20T00:00:00.000Z",
    "endedAt": "2026-02-27T00:00:00.000Z"
  },
  "sequentialPlan": {
    "method": "alpha-spending",
    "alphaBudget": 0.05,
    "totalLooksPlanned": 5,
    "minLookIntervalHours": 24,
    "stoppingBoundary": "pValue <= cumulativeAlphaSpent"
  },
  "looks": [
    {
      "lookNumber": 1,
      "lookedAt": "2026-02-21T00:00:00.000Z",
      "cumulativeVisitors": 280,
      "cumulativeConversions": 28,
      "pValue": 0.047,
      "alphaSpent": 0.01,
      "decision": "continue"
    }
  ],
  "finalDecision": {
    "status": "winner-declared",
    "lookNumber": 5,
    "reason": "Crossed alpha-spending boundary at planned final look."
  }
}
```

## Checks Implemented

### Error checks

- `NO_LOOKS_RECORDED`: no interim looks provided.
- `MISSING_SEQUENTIAL_PLAN`: missing `sequentialPlan.method`.
- `LOOK_CADENCE_TOO_FREQUENT`: effective looks/week exceeds policy.
- `INVALID_LOOK_NUMBER`: non-positive/non-numeric look number.
- `INVALID_LOOK_TIMESTAMP`: non-parseable look timestamp.
- `INVALID_CUMULATIVE_COUNTS`: invalid cumulative metrics or conversions > visitors.
- `INVALID_ALPHA_SPENT`: invalid alpha spending value.
- `ALPHA_BUDGET_EXCEEDED`: alpha spent above budget.
- `INVALID_PVALUE`: p-value outside `[0,1]`.
- `LOOK_SEQUENCE_GAP`: look numbers not contiguous.
- `LOOK_INTERVAL_TOO_SHORT`: less than minimum interval between looks.
- `CUMULATIVE_VISITORS_DECREASED`: visitors decreased vs prior look.
- `CUMULATIVE_CONVERSIONS_DECREASED`: conversions decreased vs prior look.
- `ALPHA_SPENT_DECREASED`: alpha spent decreased vs prior look.
- `STOP_WITHOUT_BOUNDARY`: `stop_winner` decision where `pValue > alphaSpent`.
- `FINAL_DECISION_LOOK_OUT_OF_RANGE`: final decision references missing look.

### Warning checks

- `LOW_SAMPLE_AT_LOOK`: cumulative visitors below minimum threshold.

## CLI Usage

From `OpsHub/`:

```bash
node scripts/paywall-sequential-check.js \
  --as-of 2026-02-27T00:00:00.000Z \
  --output artifacts/paywall-sequential-check-sample.json
```

Optional flags:

- `--input <path>`: custom input payload.
- `--output <path>`: write report JSON.
- `--as-of <iso8601>`: deterministic generated timestamp.
- `--alpha-budget <n>`: override policy alpha budget.
- `--min-look-interval-hours <n>`: minimum time between looks.
- `--max-looks-per-week <n>`: cadence limit.
- `--min-cumulative-visitors <n>`: minimum sample size threshold.
- `--fail-on-issues`: return non-zero on error findings.

## Output Contract

Top-level report fields:

- `generatedAt`
- `experimentId`
- `policy`
- `observed` (`lookCount`, `analysisWindowDays`)
- `summary` (`status`, `errors`, `warnings`)
- `findings[]` (`severity`, `code`, `message`, `remediation`, optional `context`)

## Sample Artifact

See: `OpsHub/artifacts/paywall-sequential-check-sample.json`
