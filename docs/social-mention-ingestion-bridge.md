# Slack Social Mention Ingestion Bridge (social-progress cron)

This bridge enables `social-progress` cron loops to convert recent Slack social-channel messages/mentions into structured OpsHub task payloads.

## What it does

1. Fetches recent social messages from either:
   - a runtime provider (`listMessages`) when available, or
   - a local JSON feed (`--feed-path`) for deterministic runs/tests.
2. Normalizes each message into a structured queue entry.
3. Detects actionable messages and maps each into OpsHub task payload fields:
   - `title`
   - `owner`
   - `acceptanceCriteria[]`
   - `priority`
4. Emits diagnostics + fallback metadata when Slack feed is unavailable.

## Script

- `scripts/social-mention-ingest.js`

## CLI usage

```bash
node scripts/social-mention-ingest.js \
  --channel=social-progress \
  --feed-path=artifacts/social-mention-feed-sample.json \
  --queue-out=artifacts/social-mention-queue.json \
  --tasks-out=artifacts/social-mention-task-payloads.json \
  --diagnostics-out=artifacts/social-mention-diagnostics.json
```

If no provider/feed is available, the script still succeeds with:
- empty queue + empty payload list
- `diagnostics.fallbackApplied=true`
- `diagnostics.reason` describing the blocker (`no_feed_source_configured`, file/provider failure, etc.)

## Output artifacts

- `artifacts/social-mention-queue.json`
- `artifacts/social-mention-task-payloads.json`
- `artifacts/social-mention-diagnostics.json`

## Tests

- `test/social-mention-ingest.test.js`

Run all tests:

```bash
npm test
```
