# PantryPal Task Queue (Auto-generated)

- [ ] PP-GROWTH-001-personalized-rescue-recipes-from-expiring-inventory — Personalized rescue recipes from expiring inventory (score: 80.20, owner: growth-oncall)
  - Acceptance criteria:
    - [ ] Experiment spec includes hypothesis, segment, channel, and success metric (weekly meal-plan saves).
    - [ ] A/B test is configured with event instrumentation and minimum detectable lift target of 12%.
    - [ ] Sample-size gate is defined: at least 1200 qualified households over 14 days.
    - [ ] Guardrail is monitored and passes: recipe dismiss rate stays below 20%.
    - [ ] Validation completed with command: npm test -- test/pantrypal-task-accelerator.test.js.
    - [ ] Decision log is updated with launch date, owner, and rollback trigger.
- [ ] PP-GROWTH-002-referral-booster-after-first-successful-pantry-save — Referral booster after first successful pantry save (score: 72.30, owner: growth-oncall)
  - Acceptance criteria:
    - [ ] Experiment spec includes hypothesis, segment, channel, and success metric (7-day activation rate).
    - [ ] A/B test is configured with event instrumentation and minimum detectable lift target of 8%.
    - [ ] Sample-size gate is defined: at least 1200 qualified households over 14 days.
    - [ ] Guardrail is monitored and passes: unsubscribe rate does not increase by >1%.
    - [ ] Validation completed with command: npm test -- test/pantrypal-growth-experiment-prioritizer.test.js.
    - [ ] Decision log is updated with launch date, owner, and rollback trigger.
- [ ] PP-GROWTH-003-household-challenge-leaderboard-for-waste-reduction-streaks — Household challenge leaderboard for waste reduction streaks (score: 70.80, owner: growth-oncall)
  - Acceptance criteria:
    - [ ] Experiment spec includes hypothesis, segment, channel, and success metric (7-day activation rate).
    - [ ] A/B test is configured with event instrumentation and minimum detectable lift target of 8%.
    - [ ] Sample-size gate is defined: at least 1200 qualified households over 14 days.
    - [ ] Guardrail is monitored and passes: unsubscribe rate does not increase by >1%.
    - [ ] Validation completed with command: npm test -- test/pantrypal-task-accelerator.test.js.
    - [ ] Decision log is updated with launch date, owner, and rollback trigger.

## Queue Health
Incoming experiments: 3
Eligible experiments (minimum score): 0
Queue size: 3
Ready tasks: 3
Blocked tasks: 0
Readiness: 100%
Top blockers: none
Queue light: yes (threshold: 3)
Next action: Execute top ready PantryPal experiment now and monitor first-hour guardrail.

## Execute Immediately
Top task: PP-GROWTH-001-personalized-rescue-recipes-from-expiring-inventory — Personalized rescue recipes from expiring inventory
### Critical Acceptance Checklist
1. Experiment spec includes hypothesis, segment, channel, and success metric (weekly meal-plan saves).
2. A/B test is configured with event instrumentation and minimum detectable lift target of 12%.
3. Sample-size gate is defined: at least 1200 qualified households over 14 days.

### Launch Steps
1. Draft experiment brief in tracker with owner + rollout window.
2. Prepare treatment/control variants and QA events in staging.
3. Gate launch against acceptance checklist (3 critical checks).
4. Run validation: npm test -- test/pantrypal-task-accelerator.test.js.
5. Launch to 10% holdout split and monitor first-hour guardrail.

## Validation Result
Status: NOT_RUN
Command: npm test -- test/pantrypal-task-accelerator.test.js
Exit code: n/a
Duration: 0ms
Recent output:
```
Skipped by --no-validate flag.
```
