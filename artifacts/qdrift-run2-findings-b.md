## Quality Drift Root-Cause Analysis

### 1. Local-Path Leakage

**What**: Absolute paths (`/Users/claw/.openclaw/workspace/OpsHub/...`) embedded in 24 instances across 13 artifact files via `kanbanPath` and `artifactsDir` metadata fields. Classified as **OWASP LLM02:2025** (Sensitive Information Disclosure).

**Root Causes**:

- **RC-1: No output sanitization gate on artifact writes.** Scripts call `path.resolve(__dirname, ...)` and write the result directly to JSON/markdown. No `sanitizeArtifactPaths()` function exists.
  - Sources: `scripts/inprogress-stale-cleanup.js:288`, `scripts/qa-evidence-integrity-checker.js:332-333`, `scripts/kanban-quarantine-synthetic.js:220`, `scripts/auto-seed-queue-task.js:58`

- **RC-2: QDRIFT-02 gate scoped too narrowly.** The `lib/human-deliverable-guard.js` regex correctly detects `/Users/`, `/home/`, `/tmp/` paths — but it's only wired into **done-transition task descriptions**, not artifact file generation.
  - Sources: `lib/human-deliverable-guard.js:1-67`, `docs/qdrift-02-output-gate.md`

- **RC-3: No CLAUDE.md rule preventing path leakage.** AI agents generating artifacts have no guardrail instruction.
  - Source: `CLAUDE.md` (no path-sanitization rule)

- **RC-4: No retroactive cleanup.** 13 existing files from before QDRIFT-02 remain contaminated.
  - Source: `artifacts/qdrift-claude-research-quality-drift-findings.md:11-28`

**Remediation Acceptance Criteria**:

| # | Criterion | Verification |
|---|-----------|-------------|
| AC-1 | `sanitizeArtifactPaths(content)` strips `/Users/*`, `/home/*`, `/root/*`, `C:\Users\*`, `/var/*` before any `fs.writeFileSync` in report scripts | Unit test with fixture containing each pattern |
| AC-2 | All 4 generator scripts (`inprogress-stale-cleanup`, `qa-evidence-integrity-checker`, `kanban-quarantine-synthetic`, `auto-seed-queue-task`) call sanitizer pre-write | Grep for raw `kanbanPath: args.kanban` returns 0 hits |
| AC-3 | 13 existing contaminated artifacts retroactively cleaned | `grep -r '/Users/' artifacts/` returns 0 hits |
| AC-4 | CLAUDE.md updated: "Never include absolute local filesystem paths in artifact outputs. Use project-relative paths only." | File inspection |
| AC-5 | CI/lint script (`report-template-lint.js`) fails on any artifact containing absolute local paths | Test with intentionally-leaked fixture |

---

### 2. PantryPal Priority Drift

**What**: Strategic PantryPal work (growth experiments, win-back tests, rescue onboarding) is systematically starved by synthetic queue churn. Only **3.9% of active queue** is strategic; 55% of the 462-task corpus is synthetic placeholders. In-progress stale rate: **96%**.

**Root Causes**:

- **RC-5: Synthetic task creation without lifecycle governance.** Smoke (85), lifecycle (77), and integration-dashboard (56) tasks are created freely with no TTL or completion criteria, flooding the queue.
  - Source: `artifacts/qdrift-claude-research-quality-drift-findings.md:31-58`

- **RC-6: Auto-seed condition unreachable.** `auto-seed-queue-task.js:50` seeds strategic work only when `todo + inProgress === 0` — a condition that never occurs due to churn volume.
  - Source: `scripts/auto-seed-queue-task.js:50`

- **RC-7: Priority score writeback missing.** `pantrypal-priority-guardrails.js` computes scores but doesn't persist them back to `kanban.json`. Scoring is ephemeral — only applied at ingestion time via `social-mention-ingest.js:300`.
  - Sources: `scripts/pantrypal-priority-guardrails.js:56-76`, `scripts/social-mention-ingest.js:300`

- **RC-8: No strategic queue reservation.** No mechanism reserves a minimum percentage of active queue slots for `intelligent-iteration` sourced tasks. Synthetic churn fills all slots.
  - Source: `artifacts/qdrift-claude-research-quality-drift-findings.md:61-76` (RC-5 in doc)

- **RC-9: Urgency bias in queue design.** No Eisenhower-quadrant separation. Visible synthetic churn always wins over invisible strategic work.
  - Source: `artifacts/qdrift-claude-research-quality-drift-findings.md:75-76`

**What's already fixed** (QDRIFT-04/05):
- Weighted scoring: PantryPal +3, synthetic -2 (`scripts/pantrypal-priority-guardrails.js:40-54`)
- Synthetic cap: default 2 at ingestion (`scripts/pantrypal-priority-guardrails.js:56-76`)
- Dashboard drift alert at <60% PantryPal share (`server.js:236`)
- 60-min TTL auto-expiry for synthetic tasks (`scripts/kanban-ttl-sweep.js:67`)
- Quarantine mechanism for overflow (`scripts/social-mention-ingest.js:347-366`)
- Test coverage: 4 test cases in `test/pantrypal-priority-guardrails.test.js`

**Remediation Acceptance Criteria** (remaining gaps):

| # | Criterion | Verification |
|---|-----------|-------------|
| AC-6 | Auto-seed triggers when strategic task count < 3 (not when queue is empty) | Unit test: queue has 50 synthetic + 0 strategic → seed fires |
| AC-7 | 30% strategic reservation enforced: if `strategic / active < 0.3`, block new synthetic task admission | Integration test with mixed queue |
| AC-8 | Priority scores written back to `task.computedScore` field in `kanban.json` on every guardrail run | JSON inspection after guardrail execution |
| AC-9 | TTL sweep runs on a schedule (not just on-demand) or is wired into the ingestion pipeline | `social-mention-ingest` calls `sweepExpiredTasks()` before enqueue |
| AC-10 | Dashboard shows strategic vs synthetic ratio with trend line, not just drift boolean | API test: `/api/dashboard` returns `strategicRatio` numeric field |

---

### Summary Matrix

| Drift Type | Active RCs | Already Fixed | Remaining ACs |
|---|---|---|---|
| Local-path leakage | 4 (RC-1 through RC-4) | QDRIFT-02 gate (narrow scope) | AC-1 through AC-5 |
| Priority drift | 5 (RC-5 through RC-9) | QDRIFT-04 scoring, QDRIFT-05 TTL | AC-6 through AC-10 |
