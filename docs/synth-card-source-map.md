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
- **Guard paths:**
  - `lib/kanban-write-safety.js` → `enforceApiOnlyProductionWrite(...)`
  - `lib/synthetic-write-guard.js` → `evaluateSyntheticWriteGuard(...)`
- **Flow:** mention payload mapping → API-only production write lock check → PantryPal prioritization/quarantine → synthetic write guard before `todo` insertion → kanban write (isolated test fixtures only).

## Why synthetic cards previously appeared

Script paths wrote directly to `data/kanban.json` and bypassed API contracts. Without a production-path lock, synthetic placeholders could be inserted by script-driven ingestion even when API admission was stricter.

## Current hardening state

- Production board writes are API-only (`PRODUCTION_BOARD_API_ONLY` for script/harness write attempts).
- Synthetic signatures are still denied by API admission guard in production mode.
- Existing synthetic/test cards can be purged via `POST /api/kanban/cleanup-synthetic`.

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

### D) Script path targeting production board (blocked regardless mode)
1. Call `enqueueTaskPayloadsToKanban(...)` with `kanbanPath=data/kanban.json` and `mode: 'diagnostic'`.
2. Expected: `attempted=false`, `reason='PRODUCTION_BOARD_API_ONLY'`.
3. Verified by test: `test/social-mention-ingest.test.js`.

## Regression guard artifacts (SYNTH-03)
- `lib/synthetic-write-guard.js` (centralized production guard)
- `test/synthetic-write-guard.test.js` (unit coverage)
- `test/social-mention-ingest.test.js` (script write-path regression coverage)
