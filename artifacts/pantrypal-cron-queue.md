# PantryPal Task Queue (Auto-generated)

- [ ] PP-GROWTH-001-low-stock-protein-rescue-cards-in-3-tap-meal-builder — Low-stock protein rescue cards in 3-tap meal builder (score: 82.55, owner: growth-cron)
  - Acceptance criteria:
    - [ ] Experiment spec includes hypothesis, segment, channel, and success metric (protein-category rescue completion rate).
    - [ ] A/B test is configured with event instrumentation and minimum detectable lift target of 10%.
    - [ ] Sample-size gate is defined: at least 1650 qualified households over 12 days.
    - [ ] Guardrail is monitored and passes: meal-builder exit rate does not increase by >1.1%.
    - [ ] Validation completed with command: npm test -- test/pantrypal-task-accelerator.test.js.
    - [ ] Decision log is updated with launch date, owner, and rollback trigger.
- [ ] PP-GROWTH-002-friday-night-rescue-reminder-with-20-minute-cook-filter — Friday night rescue reminder with 20-minute cook filter (score: 81.90, owner: growth-cron)
  - Acceptance criteria:
    - [ ] Experiment spec includes hypothesis, segment, channel, and success metric (same-day rescue completion rate).
    - [ ] A/B test is configured with event instrumentation and minimum detectable lift target of 9%.
    - [ ] Sample-size gate is defined: at least 1500 qualified households over 10 days.
    - [ ] Guardrail is monitored and passes: notification opt-out rate stays below 1.6%.
    - [ ] Validation completed with command: npm test -- test/pantrypal-task-accelerator.test.js.
    - [ ] Decision log is updated with launch date, owner, and rollback trigger.
- [ ] PP-GROWTH-003-post-checkout-pantry-scan-nudge-for-first-week-households — Post-checkout pantry scan nudge for first-week households (score: 81.45, owner: growth-cron)
  - Acceptance criteria:
    - [ ] Experiment spec includes hypothesis, segment, channel, and success metric (week-1 pantry scan completion rate).
    - [ ] A/B test is configured with event instrumentation and minimum detectable lift target of 8%.
    - [ ] Sample-size gate is defined: at least 1700 qualified households over 14 days.
    - [ ] Guardrail is monitored and passes: session abandonment does not increase by >1.2%.
    - [ ] Validation completed with command: npm test -- test/pantrypal-growth-experiment-prioritizer.test.js.
    - [ ] Decision log is updated with launch date, owner, and rollback trigger.

## Queue Health
Incoming experiments: 5
Eligible experiments (minimum score): 5
Queue size: 3
Ready tasks: 3
Blocked tasks: 0
Readiness: 100%
Top blockers: none
Score summary: avg 81.97, median 81.9, min 81.45, max 82.55
Score by readiness: ready avg 81.97, blocked avg 0
Acceptance criteria coverage: 3/3 tasks meet minimum 6 checks
Average criteria per task: 6
Tasks below criteria threshold: 0
Validation coverage: 3/3 tasks (100%)
Executable validation commands: 3/3 tasks (100%)
Owner load: growth-cron total 3 (ready 3, blocked 0, avg 81.97)
Ready/blocked ratio: inf
Launch risk: low
Execution priority: launch-now
Queue light: no (threshold: 2)
Ready capacity light: no (threshold: 1)
Next action: Execute top ready PantryPal experiment now and monitor first-hour guardrail.

## Execute Immediately
Top task: PP-GROWTH-001-low-stock-protein-rescue-cards-in-3-tap-meal-builder — Low-stock protein rescue cards in 3-tap meal builder
### Critical Acceptance Checklist
1. Experiment spec includes hypothesis, segment, channel, and success metric (protein-category rescue completion rate).
2. A/B test is configured with event instrumentation and minimum detectable lift target of 10%.
3. Sample-size gate is defined: at least 1650 qualified households over 12 days.

### Launch Steps
1. Draft experiment brief in tracker with owner + rollout window.
2. Prepare treatment/control variants and QA events in staging.
3. Gate launch against acceptance checklist (3 critical checks).
4. Run validation: npm test -- test/pantrypal-task-accelerator.test.js.
5. Launch to 10% holdout split and monitor first-hour guardrail.

## Validation Result
Status: PASS
Command: npm test -- test/pantrypal-task-accelerator.test.js
Exit code: 0
Duration: 195ms
Recent output:
```
# tests 59
# suites 0
# pass 59
# fail 0
# cancelled 0
# skipped 0
# todo 0
# duration_ms 69.124459
```
