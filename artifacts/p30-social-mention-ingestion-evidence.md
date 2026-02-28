# P30 Evidence — Social Slack Mention Ingestion into OpsHub Queue

## Summary
Implemented end-to-end social mention ingestion that:
1. pulls messages from a live provider adapter,
2. maps actionable messages into OpsHub task payloads,
3. dedupes by source message id,
4. records diagnostics/fallback metadata,
5. optionally enqueues deduped cards into OpsHub kanban `todo`.

## Verification
- Test suite: `npm test` (passes)
- New test coverage for kanban enqueue + dedupe:
  - `test/social-mention-ingest.test.js`

## Runtime artifact evidence
- Queue output: `artifacts/p30-social-mention-queue.json`
- Payload output: `artifacts/p30-social-mention-task-payloads.json`
- Diagnostics output: `artifacts/p30-social-mention-diagnostics.json`
- Kanban sandbox output: `artifacts/p30-kanban-sandbox.json`

Diagnostics highlights from live provider adapter run:
- `source=provider`
- `fetchedCount=1`
- `actionableCount=1`
- `fallbackApplied=false`
- `enqueue.addedCount=1`
- `enqueue.addedTaskIds=["social-live-1001"]`
