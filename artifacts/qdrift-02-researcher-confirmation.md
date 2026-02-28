# QDRIFT-02 Researcher confirmation

## Acceptance checklist

- ✅ Output gate rejects local path leakage for done/completion updates.
- ✅ Done/completion updates require `https://github.com/...` evidence.
- ✅ Sanitizer/linter checks exist for report templates.
- ✅ Pass/fail regression fixtures and tests added.
- ✅ Docs updated with compliant/non-compliant examples.
- ✅ Explicit Claude Code usage evidence captured for this cycle.

## Artifacts (to be linked in task completionDetails)

- Claude Code usage log: `artifacts/qdrift-02-claude-code-usage.log`
- Policy doc: `docs/qdrift-02-output-gate.md`
- Guard module: `lib/human-deliverable-guard.js`
- Report template linter: `scripts/report-template-lint.js`
- Fixtures: `test/fixtures/qdrift-02/pass.md`, `test/fixtures/qdrift-02/fail-local-path.md`, `test/fixtures/qdrift-02/fail-missing-github.md`
