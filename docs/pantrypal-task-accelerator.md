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
- `--experiments-file <path>` load experiment candidates from JSON array
- `--default-owner <owner>` owner attached to generated queue cards
- `--validation-command <cmd>` override validation command applied to seeded tasks
- `--execution-brief-out <path>` write a focused immediate-execution launch brief (checklist + first-hour steps + validation)

## Input file schema

`--experiments-file` expects a JSON array where each item includes:

- `name`
- `impact`, `confidence`, `ease`, `pantryPalFit` (0-1)
- optional quality gates (`primaryMetric`, `targetLiftPct`, `minimumSampleSize`, `experimentWindowDays`, `guardrail`, `validationCommand`)

## Cron-friendly output artifacts

A typical cron loop writes:

- markdown execution plan (`artifacts/pantrypal-cron-queue.md`)
- json payload (`artifacts/pantrypal-cron-queue.json`)

Both include queue health, immediate execution steps, and validation status.
