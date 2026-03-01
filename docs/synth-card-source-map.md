# Synthetic / Placeholder Card Source Map (SYNTH-01)

## Confirmed creation paths

### 1) API path (explicit card create/move)
- **File/Function:** `server.js` → `createApp()` handlers:
  - `POST /api/kanban/task`
  - `POST /api/kanban/move`
  - admission gate: `validateTaskAdmission(...)`
- **Guard path:** `lib/synthetic-write-guard.js` → `evaluateSyntheticWriteGuard(...)`
- **Flow:** HTTP request → admission gate → (production blocks known synthetic patterns) → kanban write.

### 2) Script path (Slack/social ingest direct board mutation)
- **File/Function:** `scripts/social-mention-ingest.js` → `enqueueTaskPayloadsToKanban(...)`
- **Guard path:** `lib/synthetic-write-guard.js` → `evaluateSyntheticWriteGuard(...)`
- **Flow:** mention payload mapping → PantryPal prioritization/quarantine → synthetic write guard before `todo` insertion → kanban write.

## Why synthetic cards previously appeared

The script path writes directly to `data/kanban.json` and does not go through API routes. Without a shared production write guard, synthetic placeholders could be inserted by script-driven ingestion even when API admission was stricter.

## Deterministic reproduction

### A) API guard in production mode (blocked)
1. Run server in production mode (default):
   ```bash
   npm start
   ```
2. Attempt create:
   ```bash
   curl -sS -X POST http://localhost:4180/api/kanban/task \
     -H 'content-type: application/json' \
     -d '{"name":"Integration dashboard task","description":"real details","status":"todo"}'
   ```
3. Expected: HTTP 422 + `TASK_ADMISSION_SYNTHETIC_DENIED`.

### B) API guard in diagnostic mode (allowed)
1. Run:
   ```bash
   OPSHUB_BOARD_MODE=diagnostic npm start
   ```
2. Repeat same request above.
3. Expected: task is accepted (HTTP 200).

### C) Script guard in production mode (blocked)
1. Call `enqueueTaskPayloadsToKanban(...)` with payload title `Integration dashboard task`.
2. Expected: `addedCount=0`, `blockedSyntheticCount=1`.
3. Verified by test: `test/social-mention-ingest.test.js`.

### D) Script guard in diagnostic mode (allowed)
1. Call `enqueueTaskPayloadsToKanban(...)` with `mode: 'diagnostic'` and same payload.
2. Expected: `addedCount=1`, `blockedSyntheticCount=0`.
3. Verified by test: `test/social-mention-ingest.test.js`.

## Regression guard artifacts (SYNTH-03)
- `lib/synthetic-write-guard.js` (centralized production guard)
- `test/synthetic-write-guard.test.js` (unit coverage)
- `test/social-mention-ingest.test.js` (script write-path regression coverage)
