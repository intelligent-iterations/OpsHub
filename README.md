# OpsHub

OpsHub is a lightweight local monitoring dashboard for OpenClaw workspace activity.

## What it shows

1. **Live view of active sub-agents and current tasks**
2. **Recent sessions log with timestamps**
3. **Error log for failures/issues**
4. **Token usage tracker with estimated costs and quota usage**
5. **Activity feed of last 20 actions**

The UI auto-refreshes every **60 seconds**.

## Run

```bash
cd /Users/claw/.openclaw/workspace/OpsHub
npm install
npm start
```

Open: `http://localhost:4180`

## Endpoints

- `GET /api/health` → health check
- `GET /api/dashboard` → JSON payload for all dashboard sections

## Data sources

OpsHub uses local artifacts and system commands where available:

- `tasks.md` (task/status context)
- `memory/*.md` (session-like timeline via file updates)
- git log (`git log`) for recent actions/sessions
- process list (`ps`) for any subagent-like running processes

## Limitations

- No direct OpenClaw runtime API or `openclaw` CLI is available in this environment, so some sections are inferred from local files/processes.
- Token usage/cost is approximate unless explicit usage artifacts are present.
- Error log is text-pattern based (`error`, `failed`, `blocker`, etc.) and may include false positives.

## Optional config

- `PORT` (default `4180`)
- `OPS_HUB_TOKEN_QUOTA` (default `1000000`)
