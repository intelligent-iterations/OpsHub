# PantryPal Task Queue (Auto-generated)

- [ ] PP-GROWTH-001-pantry-rescue-nudge-after-idle-weekend — Pantry rescue nudge after idle weekend (score: 80.50, owner: growth-oncall)
  - Acceptance criteria:
    - [ ] Experiment spec includes hypothesis, segment, channel, and success metric (72h rescue plan creation rate).
    - [ ] A/B test is configured with event instrumentation and minimum detectable lift target of 8%.
    - [ ] Sample-size gate is defined: at least 1100 qualified households over 10 days.
    - [ ] Guardrail is monitored and passes: notification mute rate stays below 1.7%.
    - [ ] Validation completed with command: npm test -- test/pantrypal-task-accelerator.test.js.
    - [ ] Decision log is updated with launch date, owner, and rollback trigger.
- [ ] PP-GROWTH-002-rescue-streak-comeback-experiment-for-lapsed-households — Rescue streak comeback experiment for lapsed households (score: 79.75, owner: growth-oncall)
  - Acceptance criteria:
    - [ ] Experiment spec includes hypothesis, segment, channel, and success metric (week-2 rescue completion rate).
    - [ ] A/B test is configured with event instrumentation and minimum detectable lift target of 10%.
    - [ ] Sample-size gate is defined: at least 1600 qualified households over 14 days.
    - [ ] Guardrail is monitored and passes: notification opt-out rate stays below 1.5%.
    - [ ] Validation completed with command: npm test -- test/pantrypal-growth-experiment-prioritizer.test.js.
    - [ ] Decision log is updated with launch date, owner, and rollback trigger.

## Queue Health
Incoming experiments: 1
Eligible experiments (minimum score): 1
Queue size: 2
Ready tasks: 2
Blocked tasks: 0
Readiness: 100%
Top blockers: none
Queue light: yes (threshold: 2)
Next action: Execute top ready PantryPal experiment now and monitor first-hour guardrail.

## Execute Immediately
Top task: PP-GROWTH-001-pantry-rescue-nudge-after-idle-weekend — Pantry rescue nudge after idle weekend
### Critical Acceptance Checklist
1. Experiment spec includes hypothesis, segment, channel, and success metric (72h rescue plan creation rate).
2. A/B test is configured with event instrumentation and minimum detectable lift target of 8%.
3. Sample-size gate is defined: at least 1100 qualified households over 10 days.

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
# tests 35
# suites 0
# pass 35
# fail 0
# cancelled 0
# skipped 0
# todo 0
# duration_ms 62.703083
```
