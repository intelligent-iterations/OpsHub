# P31 Win-Back Dormant Segment Sample

- Week key: 2026-02-23
- Holdout rule: hash(weekKey:userId) < 0.1
- Eligibility: pushEnabled=true AND recentOptOut=false AND inPaidFunnelExperiment=false

## Segment Counts

| Segment | Eligible | Target | Holdout | Actual Holdout % |
|---|---:|---:|---:|---:|
| 7-14d | 23 | 21 | 2 | 8.70% |
| 15-30d | 30 | 29 | 1 | 3.33% |
| 31-60d | 23 | 20 | 3 | 13.04% |
| Total | 76 | 70 | 6 | 7.89% |

Holdout rationale: stable weekly hash assignment preserves experimental control while preventing churn between target/holdout across reruns in the same ISO week.

## Minimum Detectable Lift (alpha=0.05, power=0.8)

Baselines: activation=10.0%, d7Retention=22.0%

| Segment | Activation MDE (pp) | Activation Rel % | D7 MDE (pp) | D7 Rel % |
|---|---:|---:|---:|---:|
| 7-14d | 62.16 | 621.61 | 85.83 | 390.15 |
| 15-30d | 85.44 | 854.36 | 117.97 | 536.24 |
| 31-60d | 52.01 | 520.08 | 71.81 | 326.42 |
