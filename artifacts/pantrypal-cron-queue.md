# PantryPal Task Queue (Auto-generated)

- [ ] PP-GROWTH-001-friday-night-rescue-reminder-with-20-minute-cook-filter — Friday night rescue reminder with 20-minute cook filter (score: 81.90, owner: growth-oncall)
  - Acceptance criteria:
    - [ ] Experiment spec includes hypothesis, segment, channel, and success metric (same-day rescue completion rate).
    - [ ] A/B test is configured with event instrumentation and minimum detectable lift target of 9%.
    - [ ] Sample-size gate is defined: at least 1500 qualified households over 10 days.
    - [ ] Guardrail is monitored and passes: notification opt-out rate stays below 1.6%.
    - [ ] Validation completed with command: npm test -- test/pantrypal-task-accelerator.test.js.
    - [ ] Decision log is updated with launch date, owner, and rollback trigger.
- [ ] PP-GROWTH-002-post-checkout-pantry-scan-nudge-for-first-week-households — Post-checkout pantry scan nudge for first-week households (score: 81.45, owner: growth-oncall)
  - Acceptance criteria:
    - [ ] Experiment spec includes hypothesis, segment, channel, and success metric (week-1 pantry scan completion rate).
    - [ ] A/B test is configured with event instrumentation and minimum detectable lift target of 8%.
    - [ ] Sample-size gate is defined: at least 1700 qualified households over 14 days.
    - [ ] Guardrail is monitored and passes: session abandonment does not increase by >1.2%.
    - [ ] Validation completed with command: npm test -- test/pantrypal-growth-experiment-prioritizer.test.js.
    - [ ] Decision log is updated with launch date, owner, and rollback trigger.
- [ ] PP-GROWTH-003-sunday-prep-planner-with-expiring-ingredient-auto-fill — Sunday prep planner with expiring-ingredient auto-fill (score: 80.85, owner: growth-oncall)
  - Acceptance criteria:
    - [ ] Experiment spec includes hypothesis, segment, channel, and success metric (weekly rescue plan creation rate).
    - [ ] A/B test is configured with event instrumentation and minimum detectable lift target of 11%.
    - [ ] Sample-size gate is defined: at least 1800 qualified households over 14 days.
    - [ ] Guardrail is monitored and passes: recipe dismiss rate stays below 18%.
    - [ ] Validation completed with command: npm test -- test/pantrypal-task-accelerator.test.js.
    - [ ] Decision log is updated with launch date, owner, and rollback trigger.

## Queue Health
Incoming experiments: 3
Eligible experiments (minimum score): 3
Queue size: 3
Ready tasks: 3
Blocked tasks: 0
Readiness: 100%
Top blockers: none
Score summary: avg 81.4, median 81.45, min 80.85, max 81.9
Score by readiness: ready avg 81.4, blocked avg 0
Acceptance criteria coverage: 3/3 tasks meet minimum 6 checks
Average criteria per task: 6
Tasks below criteria threshold: 0
Validation coverage: 3/3 tasks (100%)
Executable validation commands: 3/3 tasks (100%)
Queue light: no (threshold: 2)
Ready capacity light: no (threshold: 1)
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
Duration: 189ms
Recent output:
```
# tests 39
# suites 0
# pass 39
# fail 0
# cancelled 0
# skipped 0
# todo 0
# duration_ms 65.980292
```
