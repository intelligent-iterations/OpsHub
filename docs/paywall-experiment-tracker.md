# Paywall Experiment Tracker + Weekly Winner Auto-Pick

## Purpose

This tracker standardizes weekly paywall variant scoring and deterministic winner selection for rollout decisions. It incorporates industry-standard statistical guardrails to prevent acting on unreliable data.

## Input Contract

`paywall-experiment-score.js` accepts JSON:

```json
{
  "experimentId": "paywall-weekly-001",
  "variants": [
    { "id": "control", "visitors": 1050, "conversions": 89 },
    { "id": "headline-value", "visitors": 1030, "conversions": 110 }
  ]
}
```

Rules:
- `visitors` and `conversions` must be non-negative numbers
- `conversions <= visitors`
- variant IDs must be unique per experiment

## Scoring Method

Each variant is ranked by the 95% Wilson lower bound on conversion rate:

1. Compute observed conversion rate `p = conversions / visitors`
2. Compute Wilson lower bound (z = 1.96)
3. Rank descending by:
   1. `confidenceScore` (Wilson lower bound)
   2. `conversionRate`
   3. `visitors`
   4. `id` (lexicographic)

The Wilson score interval is recommended for general use because it remains accurate for small samples (stable from n ≈ 10) and for edge proportions near 0 or 1, unlike the normal (Wald) approximation which can produce impossible intervals ([Wikipedia: Binomial proportion confidence interval](https://en.wikipedia.org/wiki/Binomial_proportion_confidence_interval), [econometrics.blog: Wilson Confidence Interval](https://www.econometrics.blog/post/the-wilson-confidence-interval-for-a-proportion/)).

## Guardrails

Three configurable guardrails prevent acting on unreliable or corrupted results:

### 1. Sample Ratio Mismatch (SRM) Check

Before scoring, a chi-squared goodness-of-fit test compares observed visitor counts against the expected equal split. If the p-value falls below `srmThreshold` (default 0.01), the experiment is flagged as having a sample ratio mismatch and **no winner is declared**.

SRM occurs in roughly 6–10% of A/B tests and indicates a broken randomization or instrumentation bug. When detected, no metric results should be trusted ([Microsoft Research: Diagnosing SRM](https://www.microsoft.com/en-us/research/articles/diagnosing-sample-ratio-mismatch-in-a-b-testing/), [Statsig: SRM Guide](https://www.statsig.com/blog/sample-ratio-mismatch), [Optimizely: Automatic SRM Detection](https://www.optimizely.com/insights/blog/introducing-optimizelys-automatic-sample-ratio-mismatch-detection/)).

### 2. Confidence Floor

A minimum Wilson lower bound (`confidenceFloor`, default 0) that a variant must reach to be eligible as winner. This prevents declaring a winner when all variants have low or uncertain conversion rates. Set this based on your product's baseline conversion rate (e.g., 0.05 for a product with ~8% baseline).

### 3. Anomaly Detection (Max Conversion Rate)

Variants with a conversion rate above `maxConversionRate` (default 1.0, effectively disabled) are flagged as `anomalous` and excluded from winner selection. This catches data quality issues like double-counted conversions or bot traffic. For paywall experiments, a cap of 0.30–0.50 is a reasonable starting point ([Adapty: Paywall Experiments Playbook](https://adapty.io/blog/paywall-experiments-playbook/)).

### Guardrail Design References

The guardrail taxonomy follows Spotify's four-metric classification (success, guardrail, deterioration, quality) and Airbnb's experimentation guardrail framework:

- [Spotify Engineering: Risk-Aware Product Decisions](https://engineering.atspotify.com/2024/03/risk-aware-product-decisions-in-a-b-tests-with-multiple-metrics)
- [Airbnb Tech Blog: Designing Experimentation Guardrails](https://medium.com/airbnb-engineering/designing-experimentation-guardrails-ed6a976ec669)
- [PostHog: Guardrail Metrics for A/B Tests](https://posthog.com/product-engineers/guardrail-metrics)

## Weekly Winner Auto-Pick Policy

- Default eligibility threshold: `minVisitors = 500`
- Winner = highest-ranked variant that meets ALL of:
  1. `visitors >= minVisitors`
  2. `confidenceScore >= confidenceFloor`
  3. `anomalous === false`
  4. SRM check passes (no mismatch)
- If no variant is eligible, winner is `null`

## CLI Usage

```bash
node scripts/paywall-experiment-score.js \
  --as-of 2026-02-27T00:00:00.000Z \
  --output artifacts/paywall-experiment-score-sample.json
```

Optional flags:
- `--input <path>` custom experiment payload
- `--min-visitors <n>` change auto-pick threshold (default: 500)
- `--confidence-floor <n>` minimum Wilson lower bound to declare winner (default: 0)
- `--max-conversion-rate <n>` flag variants above this rate as anomalous (default: 1.0)
- `--srm-threshold <p>` p-value threshold for SRM check (default: 0.01)
- `--as-of <iso8601>` pin deterministic report timestamp

## Output Contract

JSON output:
- `generatedAt`
- `experimentId`
- `policy` (`method`, `confidenceLevel`, `minVisitors`, `confidenceFloor`, `maxConversionRate`, `srmThreshold`)
- `guardrails` (`srm { chiSquared, pValue, mismatch }`, `confidenceFloorApplied`, `anomalyCheckApplied`)
- `rankedVariants[]` (`id`, `visitors`, `conversions`, `conversionRate`, `confidenceScore`, `eligible`, `anomalous`, `rank`)
- `winner` (selected variant summary or `null`)

## Determinism

For reproducible weekly reports:
- pass explicit `--as-of`
- use fixed input snapshot for the reporting week
- persist the artifact under `artifacts/`
