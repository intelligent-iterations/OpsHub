# Agent Activity Monitoring Service

OpsHub now exposes a first-class Agent Activity monitoring service backed by OpenClaw gateway/session telemetry.

## What it provides

- Active session inventory (all current agent sessions from telemetry)
- Per-agent drilldown timeline
- Timeline event fields:
  - tool name
  - input args
  - output/result
  - status
  - timestamp
- Near-real-time refresh (`refreshSeconds: 5` for summary + trace APIs)
- Sensitive-value redaction in tool input/output before rendering

## API endpoints

### `GET /api/agent-activity/summary`

Returns:

- `generatedAt`
- `refreshSeconds`
- `counts.activeSessions`
- `counts.runs`
- `counts.sessionsWithToolEvents`
- `agents[]`
  - `sessionKey`
  - `sessionId`
  - `agent`
  - `state`
  - `lastUpdate`
  - `lastMessage`
  - `toolEventCount`
  - `latestTool`
  - `latestStatus`

### `GET /api/agent-activity/trace/:sessionKey`

Returns:

- `generatedAt`
- `refreshSeconds`
- `sessionKey`
- `agent`
- `state`
- `runId`
- `timeline[]`
  - `timestamp`
  - `source` (`session` or `run`)
  - `toolName`
  - `status`
  - `input` (redacted)
  - `output` (redacted)

## Redaction policy

`lib/redaction.js` masks:

- Keys containing token/secret/password/api-key/auth/cookie/private-key hints
- Bearer tokens
- JWT-like tokens
- GitHub PAT patterns (`ghp_`, `gho_`, etc.)
- `sk-...` style API keys
- Generic assignment patterns (`token=...`, `password: ...`)

Both API payloads and UI drilldown consume only redacted values.

## UI behavior

- New dashboard panel: **Agent Activity Monitor**
- Active agent rows are clickable
- Clicking opens modal trace view with live refresh every 5s
- Timeline shows status + tool IO + timestamps
