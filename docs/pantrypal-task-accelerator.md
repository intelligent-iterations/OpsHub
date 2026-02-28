# PantryPal Task Accelerator CLI

Generates a prioritized PantryPal growth experiment queue with acceptance criteria, then chooses an immediate execution candidate and runs its validation command.

## Usage

```bash
# default built-in experiments
node scripts/pantrypal-task-accelerator.js

# run against a queue file and custom owner
node scripts/pantrypal-task-accelerator.js \
  --experiments-file data/pantrypal-experiments-cron.json \
  --default-owner growth-cron \
  --validation-command "npm test -- test/pantrypal-task-accelerator.test.js"

# json output for automation
node scripts/pantrypal-task-accelerator.js --json
```

## Flags

- `--json` output machine-readable queue payload
- `--no-validate` skip immediate validation command execution
- `--limit <n>` cap queue size (default: `3`)
- `--minimum-score <n>` filter by score before ranking (default: `75`)
- `--light-threshold <n>` queue-light threshold for auto-seeding (default: `2`)
- `--seed-max-tasks <n>` cap how many auto-seeded experiments can be injected during a light-queue cycle (default: computed gap-to-target)
- `--no-auto-seed` disable synthetic queue seeding and only rank existing backlog experiments
- `--experiments-file <path>` load experiment candidates from JSON array
- `--default-owner <owner>` owner attached to generated queue cards
- `--validation-command <cmd>` override validation command applied to seeded tasks
- `--validation-timeout-ms <ms>` override validation command timeout (default: `120000`)
- `--execution-brief-out <path>` write a focused immediate-execution launch brief (checklist + first-hour steps + validation)
- `--experiment-spec-out <path>` write a structured JSON experiment spec for the immediate execution task (hypothesis, rollout, instrumentation, acceptance criteria)

## Input file schema

`--experiments-file` expects a JSON array where each item includes:

- `name`
- `impact`, `confidence`, `ease`, `pantryPalFit` (0-1)
- optional quality gates (`primaryMetric`, `targetLiftPct`, `minimumSampleSize`, `experimentWindowDays`, `guardrail`, `validationCommand`)

## Cron-friendly output artifacts

A typical cron loop writes:

- markdown execution plan (`artifacts/pantrypal-cron-queue.md`)
- json payload (`artifacts/pantrypal-cron-queue.json`)
- immediate execution brief (`artifacts/pantrypal-cron-brief.md`)
- immediate experiment spec (`artifacts/pantrypal-cron-experiment-spec.json`)

Together these include queue health, immediate execution steps, validation status, and launch-ready experiment scaffolding.
