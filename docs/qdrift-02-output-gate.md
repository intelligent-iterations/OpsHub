# QDRIFT-02: Human-facing output gate

## Scope

This change blocks local filesystem evidence leakage in human-facing completion updates and enforces GitHub URL evidence for Done transitions.

## Enforced rules

1. Reject local path refs in completion text:
   - `/Users/...`
   - `/tmp/...`
   - Relative local refs such as `artifacts/...`, `docs/...`, `./...`
2. Require at least one `https://github.com/...` URL for Done/completion updates.

## Compliant examples

```text
CompletionDetails: Verified and complete.
Evidence: https://github.com/larryclaw/OpsHub/commit/abcd1234
```

```text
Summary: Tests passed.
Evidence: https://github.com/larryclaw/OpsHub/blob/main/test/api.test.js
```

## Non-compliant examples

```text
Evidence: /Users/claw/.openclaw/workspace/OpsHub/artifacts/report.md
```

```text
Evidence: artifacts/qdrift-02-evidence.md
```

## Researcher confirmation

- ✅ Output gate rejects local paths in Done create/move API paths.
- ✅ Done/completion transitions require `https://github.com/...` evidence.
- ✅ Report template sanitizer/linter added (`scripts/report-template-lint.js`).
- ✅ Regression fixtures added under `test/fixtures/qdrift-02/` (pass/fail).
- ✅ Tests added for guard, API gate, and template lint behavior.
