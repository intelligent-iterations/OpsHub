# Artifact Cleanup Policy

## Purpose
Prevent diagnostic/test artifacts from polluting production-facing views and reports.

## Policy
1. Diagnostic/test artifacts are temporary and should be removed after review.
2. Artifacts matching these classes are cleanup candidates when older than threshold:
   - `qa-evidence*`
   - `inprogress-stale-report*`
   - `*synthetic*`
   - `*diagnostic*`
   - `*tmp*`
3. Default retention: **7 days**.
4. Cleanup is dry-run by default; `--apply` required to delete.

## Implementation
- Script: `scripts/cleanup-artifacts.js`
- Example dry-run:
  - `node scripts/cleanup-artifacts.js --older-than-days 7`
- Example apply:
  - `node scripts/cleanup-artifacts.js --older-than-days 7 --apply`

## Production safety
- CI guard script: `scripts/ci-guard-production-kanban.js`
- Fails CI if tests mutate `data/kanban.json`.
