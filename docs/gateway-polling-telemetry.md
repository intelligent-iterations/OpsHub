# Gateway Polling Telemetry (OpsHub)

OpsHub dashboard now includes a resilient gateway polling layer for live sub-agent visibility.

## Goal

Power **"which agents are working on what"** in the UI, even when the OpenClaw gateway is partially unavailable.

## Payload Contract

`/api/dashboard` → `subagents.gateway`:

```json
{
  "status": "ok|degraded|unavailable",
  "source": "OpenClaw gateway sessions",
  "polledAt": "2026-02-28T21:40:00.000Z",
  "agents": [
    {
      "id": "main:subagent:...",
      "task": "last user task or fallback",
      "status": "Active",
      "source": "OpenClaw gateway sessions",
      "ageMs": 1234,
      "owner": null,
      "sessionKey": "main:subagent:..."
    }
  ],
  "diagnostics": {
    "errors": [],
    "attempts": 1,
    "fallbackUsed": false,
    "reason": null
  }
}
```

## Fallback Behavior

- `status=ok`: gateway command succeeded and payload parsed.
- `status=degraded`: command succeeded but payload was invalid (e.g., malformed JSON).
- `status=unavailable`: command failed or runner unavailable.

In fallback modes, dashboard still serves Kanban `inProgressTasks` so OpsHub remains useful during gateway outages.

## Compatibility

Existing fields remain intact:
- `subagents.items`
- `subagents.activeSubagents`
- `subagents.inProgressTasks`
- `subagents.diagnostics`
- `subagents.counts`

New field:
- `subagents.gateway`
