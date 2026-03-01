# Kanban Synthetic/Test Cleanup Routine

OpsHub now provides an API cleanup routine to purge legacy synthetic or test-harness cards from the production board.

## Endpoint

`POST /api/kanban/cleanup-synthetic`

### Behavior

- Scans all kanban columns (`backlog`, `todo`, `inProgress`, `done`)
- Removes cards matching synthetic fingerprints (smoke/lifecycle/integration dashboard/placeholder patterns)
- Removes cards with test/diagnostic sources (e.g., `test-*`, `synthetic-*`, `diagnostic`, `auto-seed`, `fixture`)
- Writes one activity-log audit entry describing purge count

### Response shape

```json
{
  "ok": true,
  "removedCount": 2,
  "removed": [{ "id": "...", "name": "...", "column": "todo", "source": "test-harness" }],
  "board": { "columns": {"backlog": [], "todo": [], "inProgress": [], "done": []}, "activityLog": [] }
}
```

## Run

```bash
curl -s -X POST http://127.0.0.1:4180/api/kanban/cleanup-synthetic
```

## Safety guarantees

- Production board writes are API-only (`PRODUCTION_BOARD_API_ONLY` blocks script/harness direct writes).
- Cleanup is deterministic and auditable via API response + activity log.
