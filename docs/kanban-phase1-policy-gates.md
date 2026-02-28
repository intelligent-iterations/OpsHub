# Kanban Phase 1 Policy Gates

## Enforced API paths

- `POST /api/kanban/task`
- `POST /api/kanban/move`

## 1) Strict task-admission validator

Applied when target column is active (`backlog`, `todo`, `inProgress`).

### Production-mode synthetic denylist

`OPSHUB_BOARD_MODE=production` (default) denies synthetic/placeholder patterns in task name/description.

Error code: `TASK_ADMISSION_SYNTHETIC_DENIED` (422)

### Placeholder-description gate

Rejects empty/placeholder descriptions unless:

- `source === "intelligent-iteration"`
- description includes acceptance criteria (explicit text or list bullets)

Error code: `TASK_ADMISSION_PLACEHOLDER_DESCRIPTION` (422)

### Duplicate active-task guard

Rejects duplicate normalized `(name + description)` if a matching task already exists in active columns.

Error code: `TASK_ADMISSION_DUPLICATE_ACTIVE` (409)

## 2) Done-transition hard contract

For done creation/moves, both are required:

1. Human-facing completion text passes evidence gate with GitHub link (`https://github.com/...`)
2. Verification object is complete:
   - `verification.command` (non-empty)
   - `verification.result === "pass"`
   - `verification.verifiedAt` (timestamp)

Error code: `MISSING_REQUIRED_DONE_VERIFICATION` (422)

## 3) WIP cap enforcement (`inProgress`)

Before admitting a task to `inProgress`:

- required fields: `claimedBy`, `startedAt`, `updatedAt`
- global and per-priority caps must not be exceeded
- `priority=critical` bypasses WIP cap

Config:

- `OPSHUB_INPROGRESS_WIP_LIMIT` (default `5`)
- `OPSHUB_INPROGRESS_WIP_LIMIT_HIGH` (default mirrors global limit)
- `OPSHUB_INPROGRESS_WIP_LIMIT_MEDIUM` (default mirrors global limit)
- `OPSHUB_INPROGRESS_WIP_LIMIT_LOW` (default mirrors global limit)

Errors:

- `INPROGRESS_REQUIRED_FIELDS_MISSING` (422)
- `WIP_LIMIT_EXCEEDED` (422)
