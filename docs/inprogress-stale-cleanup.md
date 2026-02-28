# In-Progress Stale Cleanup Utility

This utility safely triages stale cards in `columns.inProgress` that have no active sub-agent linkage.

Script: `scripts/inprogress-stale-cleanup.js`

## Why these cards pile up

In this repo, many lingering cards are generic `Integration dashboard task` entries with source `manual` and no sub-agent session/label metadata. They remain in `inProgress` because there is no runtime session to reconcile against.

## Detection logic

A task is flagged as stale when **both** are true:

1. It is older than `--stale-minutes` (using `updatedAt || startedAt || createdAt`), and
2. It has no active session match from `openclaw sessions --active <window> --json`.

Matching tries explicit task fields and text hints:

- `subagentSessionId`, `subagentLabel`, `sessionId`, nested `subagent.*`
- Session-like or label-like tokens found in `name/description`

## Safety model

- Default mode is **dry-run** (no mutation)
- `--apply` performs remediation by moving stale tasks from `inProgress` to `todo`
- Every moved task adds an `activityLog` entry with type `task_reassigned`

## Usage

Dry-run (recommended first):

```bash
node scripts/inprogress-stale-cleanup.js \
  --kanban data/kanban.json \
  --stale-minutes 20 \
  --active-window-minutes 3 \
  --report-json-out artifacts/inprogress-stale-report.json \
  --report-md-out artifacts/inprogress-stale-report.md
```

Apply remediation:

```bash
node scripts/inprogress-stale-cleanup.js \
  --kanban data/kanban.json \
  --stale-minutes 20 \
  --active-window-minutes 3 \
  --apply \
  --report-json-out artifacts/inprogress-stale-report.json \
  --report-md-out artifacts/inprogress-stale-report.md
```

Target a single stuck task id (repeat `--task-id` for multiple):

```bash
node scripts/inprogress-stale-cleanup.js \
  --kanban data/kanban.json \
  --stale-minutes 20 \
  --active-window-minutes 3 \
  --task-id 1677c75c-fdb4-4c75-b6c0-df9a52a122ce \
  --apply
```
