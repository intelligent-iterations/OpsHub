# Synthetic Card Prevention Reproduction & Regression Guide

This runbook reproduces and verifies synthetic-card prevention safeguards for known signatures:

- Smoke task cards
- Lifecycle task cards
- Integration dashboard task cards
- Placeholder / manager-gap simulation cards

## Prerequisites

- Node.js 20+ (or project default)
- Repo dependencies installed (`npm install`)

## 1) Run focused regression suite

```bash
node --test test/synthetic-write-guard.test.js test/api.test.js
```

Expected outcome:

- Exit code `0`
- `TASK_ADMISSION_SYNTHETIC_DENIED` assertions pass for all known signatures
- `PRODUCTION_BOARD_API_ONLY` assertions pass for script/harness write attempts targeting `data/kanban.json`

## 2) Manual API denial repro (production mode default)

Start server:

```bash
npm start
```

In another terminal:

```bash
curl -s -X POST http://127.0.0.1:4180/api/kanban/task \
  -H 'Content-Type: application/json' \
  -d '{"name":"Smoke task","description":"placeholder manager-gap simulation card","status":"todo"}'
```

Expected outcome:

- HTTP `422`
- JSON includes `"code":"TASK_ADMISSION_SYNTHETIC_DENIED"`
- Server logs a structured warning event with `event: "synthetic_write_guard_blocked"`

## 3) Cleanup existing synthetic/test cards via API routine

```bash
curl -s -X POST http://127.0.0.1:4180/api/kanban/cleanup-synthetic
```

Expected outcome:

- HTTP `200`
- JSON includes `removedCount` and per-card removal metadata
- Removed cards include synthetic signatures and test/diagnostic source entries

## 4) Full CI parity run

```bash
npm test
```

Expected outcome:

- Exit code `0`
- No synthetic-card prevention regression failures

## Notes

- Production mode is the default (`OPSHUB_BOARD_MODE=production`).
- Production board mutations are API-only; script/harness direct writes to `data/kanban.json` are denied (`PRODUCTION_BOARD_API_ONLY`).
- Diagnostic mode is allowed only for isolated non-production kanban fixtures (for tests/repro), not for production board bypass.
