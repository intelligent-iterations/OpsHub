# OpsHub

OpsHub is a lightweight local monitoring dashboard for OpenClaw workspace activity.

## What it shows

1. **Live view of active sub-agents and current tasks**
2. **Recent sessions log with timestamps**
3. **Error log for failures/issues**
4. **Token usage tracker with estimated costs and quota usage**
5. **Activity feed of last 20 actions**
6. **Local Kanban board** (Backlog / To Do / In Progress / Done)

The UI auto-refreshes every **60 seconds**.

## Run

```bash
cd /Users/claw/.openclaw/workspace/OpsHub
npm install
npm start
```

Open: `http://localhost:4180`

## Test

```bash
npm test
```

Includes a lightweight API smoke suite for health checks + kanban flows.

## Endpoints

- `GET /api/health` → health check
- `GET /api/dashboard` → JSON payload for all dashboard sections (`subagents.items` merged view + explicit `subagents.activeSubagents` and `subagents.inProgressTasks` arrays)
- `GET /api/kanban` → kanban board + activity log
- `POST /api/kanban/task` → create task
- `POST /api/kanban/move` → move task to another column

## Data sources

OpsHub uses local artifacts and system commands where available:

- `tasks.md` (task/status context)
- `memory/*.md` (session-like timeline via file updates)
- git log (`git log`) for recent actions/sessions
- process list (`ps`) for any subagent-like running processes

## QA hardening notes

- Client-side HTML escaping was added for dynamic fields shown in the dashboard (prevents script injection in rendered cards/logs).
- API routes now use centralized async error handling and return stable JSON errors on failure.
- Kanban writes are saved atomically (`kanban.json.tmp` rename) to reduce corruption risk on interrupted writes.
- Input payloads are normalized/truncated to reduce malformed/unbounded data issues.

## Optional config

- `PORT` (default `4180`)
- `OPS_HUB_TOKEN_QUOTA` (default `1000000`)
- `OPSHUB_DATA_DIR` (override kanban storage path; useful for tests)

## In-Progress stale cleanup utility

Use the safe cleanup script to detect stale `inProgress` tasks with no active sub-agent match and generate remediation reports.

- Dry-run by default (no board changes)
- Optional `--apply` moves stale tasks back to `todo`
- Adds `activityLog` entries for every auto-reassigned task

```bash
node scripts/inprogress-stale-cleanup.js \
  --kanban data/kanban.json \
  --stale-minutes 20 \
  --active-window-minutes 3 \
  --report-json-out artifacts/inprogress-stale-report.json \
  --report-md-out artifacts/inprogress-stale-report.md
```

See `docs/inprogress-stale-cleanup.md` for details.

## Limitations

- No direct OpenClaw runtime API or `openclaw` CLI is available in this environment, so some sections are inferred from local files/processes.
- Token usage/cost is approximate unless explicit usage artifacts are present.
- Error log is text-pattern based (`error`, `failed`, `blocker`, etc.) and may include false positives.
