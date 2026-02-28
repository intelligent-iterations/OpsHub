# Kanban Phase 1 Policy Gates

## Enforced API paths

- `POST /api/kanban/task`
- `POST /api/kanban/move`

## 1) Strict task-admission validator

Applied in active columns (`backlog`, `todo`, `inProgress`).

### Production-mode synthetic denylist

`OPSHUB_BOARD_MODE=production` (default) denies known synthetic/placeholder patterns (for example: `smoke task`, `lifecycle task`, `integration dashboard task`, `closeout reminder`, `placeholder`).

Error code: `TASK_ADMISSION_SYNTHETIC_DENIED` (422)

### Placeholder-description gate

For `inProgress` admissions, placeholder/empty descriptions are denied except for approved sources:

- allowed for `source=manual` or `source=ui`
- allowed for `source=intelligent-iteration` only when acceptance criteria are present

Error code: `TASK_ADMISSION_PLACEHOLDER_DESCRIPTION` (422)

### Duplicate active-task guard

Duplicate normalized `(name + description)` in active columns is rejected.

Error code: `TASK_ADMISSION_DUPLICATE_ACTIVE` (409)

## 2) Done-transition hard contract

Done creation/moves require both:

1. Completion text that passes the GitHub evidence gate (`https://github.com/...` required)
2. Strict verification object:
   - `verification.command` (non-empty)
   - `verification.result === "pass"`
   - `verification.verifiedAt` (valid timestamp)

Error code: `MISSING_REQUIRED_DONE_VERIFICATION` (422)

## 3) WIP cap enforcement (`inProgress`)

A hard cap is enforced before admitting non-critical tasks to `inProgress`.

- Config: `OPSHUB_INPROGRESS_WIP_LIMIT` (default `5`)
- `priority=critical` bypasses the cap

Error code: `WIP_LIMIT_EXCEEDED` (422)
