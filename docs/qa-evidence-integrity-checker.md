# QA Evidence Integrity Checker

`OpsHub/scripts/qa-evidence-integrity-checker.js` audits **Done** tasks in the OpsHub kanban and flags QA-evidence integrity gaps.

## What it checks

For each task in `columns.done`:

1. **Missing evidence links/refs** (`MISSING_EVIDENCE_LINK`, error)
   - Task description does not contain any evidence/doc/artifact references.
2. **Missing screenshot reference** (`MISSING_SCREENSHOT_REFERENCE`, warn)
   - Task description has no screenshot-like ref (`screenshot` keyword or image extension like `.png`, `.jpg`, `.webp`, `.gif`).
3. **Artifact reference not found on disk** (`ARTIFACT_REFERENCE_NOT_FOUND`, error)
   - Local non-URL refs are present, but the file path cannot be resolved.
4. **Missing correction log when correction occurred** (`MISSING_CORRECTION_LOG`, error)
   - If metadata indicates correction occurred, a correction log record is required before Done.
5. **Missing verification record** (`MISSING_VERIFICATION_RECORD`, error)
   - Done tasks must include verification metadata.

## Supported evidence reference patterns

- Markdown links: `[Evidence](artifacts/example-evidence.md)`
- Labeled fields in description:
  - `Evidence: artifacts/file.md`
  - `doc: pantrypal/docs/spec.md`
  - `screenshots: artifacts/shot.png`
- Bare refs/URLs in text:
  - `artifacts/example.png`
  - `https://...`

## Usage

From repo root (`/Users/claw/.openclaw/workspace`):

```bash
node OpsHub/scripts/qa-evidence-integrity-checker.js \
  --kanban OpsHub/data/kanban.json \
  --artifacts-dir artifacts \
  --json-out artifacts/opshub-qa-evidence-integrity-report.json \
  --md-out artifacts/opshub-qa-evidence-integrity-report.md
```

### CLI flags

- `--kanban <path>`: Kanban JSON file (default `OpsHub/data/kanban.json`)
- `--artifacts-dir <path>`: Artifacts root for file existence checks (default `artifacts/` at workspace root)
- `--json-out <path>`: Write machine-readable report
- `--md-out <path>`: Write human-readable markdown report
- `--fail-on-issues`: Exit with non-zero when any task fails checks (CI-friendly)
- `--max-errors <n>`: Exit with non-zero if total errors exceed `n`
- `--max-warnings <n>`: Exit with non-zero if total warnings exceed `n`
- `--top-failures <n>`: Include top `n` failing tasks in markdown remediation summary
- `--apply-rollback`: Auto-move failing Done tasks back to `inProgress` with `qa_gate_rollback` activity log entries

## CI usage examples

Fail build on any failing task:

```bash
node OpsHub/scripts/qa-evidence-integrity-checker.js \
  --kanban OpsHub/data/kanban.json \
  --artifacts-dir artifacts \
  --fail-on-issues \
  --json-out artifacts/opshub-qa-evidence-integrity-report.json \
  --md-out artifacts/opshub-qa-evidence-integrity-report.md
```

Allow a warning budget but no errors:

```bash
node OpsHub/scripts/qa-evidence-integrity-checker.js \
  --kanban OpsHub/data/kanban.json \
  --artifacts-dir artifacts \
  --max-errors 0 \
  --max-warnings 2 \
  --top-failures 3 \
  --json-out artifacts/opshub-qa-evidence-integrity-report.json \
  --md-out artifacts/opshub-qa-evidence-integrity-report.md
```

## Markdown report additions

When `--top-failures <n>` is provided and failures exist, the markdown report appends a **Top Remediation Summary** section that lists the first `n` failing tasks and their remediation guidance.

## Output schema (JSON)

Top-level:

- `generatedAt`
- `kanbanPath`
- `artifactsDir`
- `thresholds`
  - `maxErrors`, `maxWarnings`, `failOnIssues`
- `topFailures`
- `summary`
  - `doneTasksChecked`, `passed`, `failed`, `errors`, `warnings`
- `results[]`
  - `taskId`, `taskName`, `status`, `completedAt`
  - `evidenceRefs[]`
  - `screenshotRefs[]`
  - `issues[]`
    - `severity`, `code`, `message`, `remediation`, optional `refs[]`
  - `pass`

## Remediation guidance

If a task fails:

- Add an explicit `Evidence:` line with artifact and/or doc links.
- Ensure at least one screenshot artifact is generated and referenced.
- Fix broken artifact paths or regenerate missing files.
- Re-run checker until task passes.
