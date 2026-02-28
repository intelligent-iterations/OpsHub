# Live Agent Activity telemetry integration

## Overview

OpsHub now includes a dedicated **Live Agent Activity** panel and API surface for projecting live OpenClaw activity into Kanban context.

It ingests:
1. Session telemetry (`sessions --active 30 --json`)
2. Active run telemetry (`runs --active --json`)
3. Current Kanban `inProgress` tasks (`data/kanban.json`)

Then maps active sessions/runs to likely in-progress cards.

## API contract

### `GET /api/live-activity`

Returns:

- `generatedAt`
- `refreshSeconds` (15)
- `liveAgentActivity.title` (`Live Agent Activity`)
- `liveAgentActivity.items[]`:
  - `agent`
  - `currentTaskSession`
  - `state`
  - `lastUpdate`
  - `sessionKey`
  - `runId`
  - `mappedTaskId`
  - `mappedTaskName`
  - `mappingConfidence`
- `liveAgentActivity.counts` (`sessions`, `runs`, `mappedTasks`)
- `liveAgentActivity.telemetry` diagnostics (`sessionsSource`, `runsSource`, command success booleans)

### `GET /api/dashboard`

Now also embeds the same payload at `liveAgentActivity` for one-call UI refresh.

## Mapping strategy

Implemented in `lib/openclaw-live-activity.js`:

1. Build normalized matcher over Kanban `inProgress` tasks (id, name, description).
2. Merge latest run by session key (if multiple runs exist).
3. For each session, combine session + run task text.
4. Score candidate tasks:
   - id text match: +1
   - name text match: +3
   - description prefix match: +1
5. Emit best match when score > 0 and attach confidence (`low`/`medium`/`high`).

## UI integration

- `public/index.html` adds a section titled **Live Agent Activity**.
- `public/app.js` renders panel rows with required fields:
  - agent
  - current task/session
  - state
  - last update

## Failure handling

If OpenClaw CLI commands are unavailable, the endpoint remains stable:

- returns empty arrays/counts where appropriate
- includes command diagnostics so operators can quickly identify missing telemetry sources

This keeps existing dashboard behavior stable while enabling live integration when telemetry is available.
