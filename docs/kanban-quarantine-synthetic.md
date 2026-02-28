# Kanban Synthetic Card Quarantine Policy

## Purpose

Prevent repeated synthetic/manual spam cards (notably `Integration dashboard task`) from polluting active Kanban columns.

## Detection Policy

A card is quarantined when all of the following are true:

1. `name` is exactly `Integration dashboard task` (case-insensitive), and
2. it appears in `todo`, `inProgress`, or `backlog`, and
3. it is likely synthetic based on either:
   - `source: manual`, or
   - description marker `should appear in subagents.inProgressTasks`.

## Quarantine Behavior

Script: `scripts/kanban-quarantine-synthetic.js`

Modes:

- `--report` (default): detect + report only, no data mutation.
- `--apply`: remove matched cards from active columns and create a single backlog rollup card:
  - id: `quarantine-synthetic-integration-dashboard-task-rollup`
  - name: `[Quarantine] Synthetic "Integration dashboard task" cards`

Activity log entries are appended for each quarantined card plus a rollup update entry.

## Usage

```bash
# report-only (stdout)
node scripts/kanban-quarantine-synthetic.js --report

# report-only with artifact files
node scripts/kanban-quarantine-synthetic.js \
  --report \
  --report-json-out artifacts/p28-kanban-quarantine-sample.json \
  --report-md-out artifacts/p28-kanban-quarantine-sample.md

# apply to kanban.json
node scripts/kanban-quarantine-synthetic.js --apply
```

## Rollback

If `--apply` produced an undesired quarantine:

1. Restore `data/kanban.json` from git:
   ```bash
   git checkout -- data/kanban.json
   ```
2. Or manually delete the rollup card (`quarantine-synthetic-integration-dashboard-task-rollup`) and move affected tasks back into intended columns.
3. Re-run script in `--report` mode first before applying again.
