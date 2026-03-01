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
- Diagnostic mode assertion confirms controlled bypass for repro/debug paths

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

## 3) Full CI parity run

```bash
npm test
```

Expected outcome:

- Exit code `0`
- No synthetic-card prevention regression failures

## Notes

- Production mode is the default (`OPSHUB_BOARD_MODE=production`).
- Diagnostic mode (`OPSHUB_BOARD_MODE=diagnostic`) is intentionally allowed for controlled simulation/reproduction workflows.
