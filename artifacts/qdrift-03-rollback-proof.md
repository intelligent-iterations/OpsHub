# QA Evidence Integrity Report

Generated: 2026-02-28T17:33:03.704Z
Kanban: /Users/claw/.openclaw/workspace/OpsHub/artifacts/qdrift-03-qa-fixture-kanban.json
Artifacts dir: /Users/claw/.openclaw/workspace/artifacts

## Summary

- Done tasks checked: **1**
- Passed: **0**
- Failed: **1**
- Errors: **2**
- Warnings: **1**
- Rolled back: **1**

## Findings

### ❌ Done without verification
- Task ID: `qa-001`
- Correction occurred: yes
- Evidence refs: `https://github.com/larryclaw/OpsHub/commit/abc123`
- Issues:
  - [WARN] **MISSING_SCREENSHOT_REFERENCE** — Done task does not reference screenshot artifact (.png/.jpg/etc).
  - [ERROR] **MISSING_CORRECTION_LOG** — Task indicates a correction occurred but no correction log record exists.
  - [ERROR] **MISSING_VERIFICATION_RECORD** — Done task has no verification record.
