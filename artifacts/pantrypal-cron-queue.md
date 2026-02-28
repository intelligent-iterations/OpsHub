# PantryPal Task Queue (Auto-generated)

- [ ] PP-GROWTH-001-friday-night-rescue-reminder-with-20-minute-cook-filter — Friday night rescue reminder with 20-minute cook filter (score: 81.20, owner: growth-cron)
  - Acceptance criteria:
    - [ ] Experiment spec includes hypothesis, segment, channel, and success metric (same-day rescue completion rate).
    - [ ] A/B test is configured with event instrumentation and minimum detectable lift target of 9%.
    - [ ] Sample-size gate is defined: at least 1500 qualified households over 10 days.
    - [ ] Guardrail is monitored and passes: notification opt-out rate stays below 1.6%.
    - [ ] Validation completed with command: npm test -- test/pantrypal-task-accelerator.test.js.
    - [ ] Decision log is updated with launch date, owner, and rollback trigger.
- [ ] PP-GROWTH-002-rescue-streak-comeback-experiment-for-lapsed-households — Rescue streak comeback experiment for lapsed households (score: 78.95, owner: growth-cron)
  - Acceptance criteria:
    - [ ] Experiment spec includes hypothesis, segment, channel, and success metric (week-2 rescue completion rate).
    - [ ] A/B test is configured with event instrumentation and minimum detectable lift target of 10%.
    - [ ] Sample-size gate is defined: at least 1600 qualified households over 14 days.
    - [ ] Guardrail is monitored and passes: notification opt-out rate stays below 1.5%.
    - [ ] Validation completed with command: npm test -- test/pantrypal-task-accelerator.test.js.
    - [ ] Decision log is updated with launch date, owner, and rollback trigger.
- [ ] PP-GROWTH-003-smart-defrost-reminder-timing-tuned-by-prep-time-tier — Smart defrost reminder timing tuned by prep-time tier (score: 76.45, owner: growth-cron)
  - Acceptance criteria:
    - [ ] Experiment spec includes hypothesis, segment, channel, and success metric (same-day rescue completion rate).
    - [ ] A/B test is configured with event instrumentation and minimum detectable lift target of 7%.
    - [ ] Sample-size gate is defined: at least 1400 qualified households over 10 days.
    - [ ] Guardrail is monitored and passes: push dismiss rate does not increase by >2%.
    - [ ] Validation completed with command: npm test -- test/pantrypal-task-accelerator.test.js.
    - [ ] Decision log is updated with launch date, owner, and rollback trigger.

## Queue Health
Incoming experiments: 1
Eligible experiments (minimum score): 1
Queue size: 3
Ready tasks: 3
Blocked tasks: 0
Readiness: 100%
Top blockers: none
Queue light: no (threshold: 2)
Next action: Execute top ready PantryPal experiment now and monitor first-hour guardrail.

## Execute Immediately
Top task: PP-GROWTH-001-friday-night-rescue-reminder-with-20-minute-cook-filter — Friday night rescue reminder with 20-minute cook filter
### Critical Acceptance Checklist
1. Experiment spec includes hypothesis, segment, channel, and success metric (same-day rescue completion rate).
2. A/B test is configured with event instrumentation and minimum detectable lift target of 9%.
3. Sample-size gate is defined: at least 1500 qualified households over 10 days.

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
Duration: 187ms
Recent output:
```
# tests 24
# suites 0
# pass 24
# fail 0
# cancelled 0
# skipped 0
# todo 0
# duration_ms 58.779792
```
