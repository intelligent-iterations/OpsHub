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

## Human-facing deliverable policy gate

Done/completion updates now enforce:

- No local filesystem path leakage (`/Users/...`, `/tmp/...`, or relative local refs like `artifacts/...`)
- At least one evidence URL matching `https://github.com/...`

Compliant example:

```text
CompletionDetails: Verification complete.
Evidence: https://github.com/larryclaw/OpsHub/commit/<sha>
```

Non-compliant examples:

```text
Evidence: /Users/claw/.openclaw/workspace/OpsHub/artifacts/report.md
Evidence: artifacts/report.md
```

Template lint:

```bash
npm run lint:report-templates
```

## Endpoints

- `GET /api/health` → health check
- `GET /api/dashboard` → JSON payload for all dashboard sections (`subagents.items` merged view + explicit `subagents.activeSubagents` and `subagents.inProgressTasks` arrays; each in-progress task includes `id`, `task`, `description`, and `priority`; `subagents.diagnostics` reports sync drift/missing IDs between kanban and payload)
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

## PantryPal-first prioritization guardrails

QDRIFT-04 introduces PantryPal-first weighted prioritization + synthetic churn quarantine/cap in automation loops.

- Core module: `scripts/pantrypal-priority-guardrails.js`
- Dashboard metric: `subagents.pantryPalWip` (share + drift alert)
- Automation integration: `scripts/social-mention-ingest.js` applies guardrails before enqueue

See `docs/pantrypal-prioritization-guardrails.md` for policy, thresholds, and test traceability.

## In-Progress stale cleanup utility

Use the safe cleanup script to detect stale `inProgress` tasks with no active sub-agent match and generate remediation reports.

- Dry-run by default (no board changes)
- Optional `--apply` moves stale tasks back to `todo`
- Autonomous recovery (default) detects stalled/waiting workers, attempts self-recovery, and auto-dispatches up to 2 fallback tasks
- Optional `--task-id <id>` scopes remediation/reporting to specific stuck cards
- Adds `activityLog` entries for reassignment + self-recovery attempts

```bash
node scripts/inprogress-stale-cleanup.js \
  --kanban data/kanban.json \
  --stale-minutes 20 \
  --active-window-minutes 3 \
  --report-json-out artifacts/inprogress-stale-report.json \
  --report-md-out artifacts/inprogress-stale-report.md
```

See `docs/inprogress-stale-cleanup.md` for details.

## Slack social mention ingestion bridge

Use the social mention bridge to convert recent Slack social-channel traffic into queue entries + OpsHub task payloads for social-progress cron loops.

```bash
# live provider path (preferred)
node scripts/social-mention-ingest.js \
  --channel=social-progress \
  --provider-module=./scripts/providers/slack-runtime-provider.js \
  --enqueue-to-kanban \
  --kanban-path=data/kanban.json

# deterministic fallback/testing path
node scripts/social-mention-ingest.js \
  --channel=social-progress \
  --feed-path=artifacts/social-mention-feed-sample.json
```

Outputs:
- `artifacts/social-mention-queue.json`
- `artifacts/social-mention-task-payloads.json` (deduped by `source.messageId`)
- `artifacts/social-mention-diagnostics.json` (fetch attempts + fallback + dedupe stats)

See `docs/social-mention-ingestion-bridge.md` for details.

## Limitations

- No direct OpenClaw runtime API or `openclaw` CLI is available in this environment, so some sections are inferred from local files/processes.
- Token usage/cost is approximate unless explicit usage artifacts are present.
- Error log is text-pattern based (`error`, `failed`, `blocker`, etc.) and may include false positives.
