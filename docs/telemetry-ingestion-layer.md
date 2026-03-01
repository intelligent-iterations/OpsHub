# Telemetry Ingestion Layer (Gateway Logs + Session Traces)

This layer normalizes OpenClaw gateway/session telemetry into one schema for observability.

## Schema

Each record follows:

- `agent`
- `session`
- `active`
- `currentToolCall`
- `toolInputs`
- `toolOutputs`
- `error`
- `exit`
- `startedAt`
- `updatedAt`
- `source` (`gateway-log|session-trace|fallback`)

Top-level envelope:

- `generatedAt`
- `schemaVersion` (`telemetry.v1`)
- `records[]`
- `diagnostics` (`errors`, `parsedLines`, `skippedLines`, `fallbackUsed`)

## Robust parsing + fallback

- Parses line-delimited JSON gateway logs (`logsText`).
- Accepts structured `sessionTraces[]`.
- If both yield no usable records, uses `fallbackRecords[]`.
- Never throws on malformed lines; records parse diagnostics and continues.

## Privacy redaction

`redactSensitive` masks known sensitive keys recursively, including:

- token/secret/password/apiKey/authorization/cookie/session-id style keys
- bearer-token-like strings

Large strings are truncated to reduce accidental data leakage.

## Files

- `scripts/telemetry-ingestion-layer.js`
- `test/telemetry-ingestion-layer.test.js`
