# Slack Social Mention Ingestion Bridge (social-progress cron)

This bridge enables `social-progress` cron loops to convert recent Slack social-channel messages/mentions into structured OpsHub task payloads.

## What it does

1. Fetches recent social messages, preferring a live provider (`listMessages`) and falling back to `--feed-path` when configured.
2. Normalizes each message into a structured queue entry.
3. Detects actionable messages and maps each into OpsHub task payload fields:
   - `title`
   - `owner`
   - `acceptanceCriteria[]`
   - `priority`
4. Dedupes actionable task payloads by source message id (`source.messageId`).
5. Emits diagnostics + fallback metadata when provider/file fetch is unavailable.

## Script

- `scripts/social-mention-ingest.js`
- Provider adapter example: `scripts/providers/slack-runtime-provider.js`

## Live provider usage (preferred)

```bash
node scripts/social-mention-ingest.js \
  --channel=social-progress \
  --provider-module=./scripts/providers/slack-runtime-provider.js \
  --queue-out=artifacts/social-mention-queue.json \
  --tasks-out=artifacts/social-mention-task-payloads.json \
  --diagnostics-out=artifacts/social-mention-diagnostics.json
```

You can also configure provider loading with env vars:
- `OPSHUB_SOCIAL_PROVIDER_MODULE` (module path)
- `OPSHUB_SOCIAL_PROVIDER_EXPORT` (export name, default `listMessages`)

The runtime adapter can optionally load an external Slack adapter through:
- `OPSHUB_SLACK_PROVIDER_ADAPTER` (module exposing `listMessages`)

## Feed-file fallback usage

```bash
node scripts/social-mention-ingest.js \
  --channel=social-progress \
  --feed-path=artifacts/social-mention-feed-sample.json
```

## Diagnostics and fallback

If provider/file sources are unavailable, the script still succeeds with:
- empty queue + empty payload list
- `diagnostics.fallbackApplied=true`
- `diagnostics.reason` describing blockers
- `diagnostics.fetchAttempts[]` with per-source attempt status/errors
- `diagnostics.dedupe` stats (`duplicateCount`, `duplicateMessageIds`)

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
