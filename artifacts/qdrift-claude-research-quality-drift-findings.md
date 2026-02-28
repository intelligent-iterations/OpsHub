# OpsHub Quality Drift Research: Local-Path Leakage & Priority Drift

**Date:** 2026-02-28
**Scope:** Deep web research + codebase evidence for two quality drift vectors
**Status:** Evidence-backed findings, implementation-ready

---

## Findings

### Finding 1: Local-Path Leakage in AI-Generated Artifacts

**17 instances** of absolute local filesystem paths leaked across **13 artifact files**. All leak the pattern `/Users/claw/.openclaw/workspace/OpsHub/...` into user-facing JSON reports and markdown deliverables.

| Vector | Files Hit | Leaked Fields | Example |
|--------|-----------|---------------|---------|
| JSON `kanbanPath` field | 7 files | `kanbanPath`, `artifactsDir` | `"kanbanPath": "/Users/claw/.openclaw/workspace/OpsHub/data/kanban.json"` |
| Markdown report headers | 6 files | `Kanban:`, `Artifacts dir:` | `Kanban: /Users/claw/.openclaw/workspace/OpsHub/data/kanban.json` |

**Affected files:**
- `artifacts/p31-qa-evidence-integrity.json` + `.md`
- `artifacts/dbc0400d-integrity-check.json` + `.md`
- `artifacts/inprogress-stale-report.json` + `.md`
- `artifacts/p29-kanban-quarantine-report.json` + `.md`
- `artifacts/p28-inprogress-cleanup-report.json` + `.md`
- `artifacts/p28-kanban-quarantine-sample.json`
- `artifacts/p29-auto-seed-report.json`

**External validation:** OWASP ranks Sensitive Information Disclosure as **LLM02:2025** (#2 risk, up from #6). CVE-2026-25593 documents a related OpenClaw path-based vulnerability where unsanitized path parameters enabled command injection via the Gateway WebSocket API.

### Finding 2: Priority Drift — Strategic Work Starved by Synthetic Queue Churn

The kanban contains **398 total tasks**. Analysis reveals systematic displacement of strategic work:

| Metric | Value | Concern |
|--------|-------|---------|
| Total active queue (todo + inProgress) | 101 tasks | Oversaturated |
| Strategic tasks in active queue | 4 tasks (3.9%) | Severely starved |
| Synthetic placeholder tasks | 218 tasks (55% of corpus) | Flooding |
| In-progress stale rate | 96% (83/86 at last audit) | Queue is ghost town |
| Avg age of synthetic tasks | 1000+ minutes | Orphaned, never completing |

**Synthetic task breakdown (218 total):**
- Smoke tasks: 85 (generic "verify kanban" placeholders)
- Lifecycle tasks: 77 (no description, no sub-agent linkage)
- Integration dashboard tasks: 56 (synthetic, repeatedly recreated)

**Strategic work documented but queue-starved:**
- PantryPal growth experiments (3 ranked, highest score 79.85) — scored but not queue-enforced
- P29 Win-Back 4-arm A/B test — fully designed, not prioritized
- P26 Conversion experiments (5 ranked paywall tests) — no active todo items
- P25 PantryPal rescue onboarding — in-progress but buried under 94 churn tasks

**Protection mechanisms exist but are insufficient:**
- `auto-seed-queue-task.js` only seeds when queue is empty (never triggers due to churn volume)
- `kanban-quarantine-synthetic.js` quarantines by name match but runs after-the-fact
- `pantrypal-growth-experiment-prioritizer.js` scores correctly but scores aren't enforced in kanban

---

## Root Causes

### RC-1: No Output Sanitization Gate
Scripts and AI agents write artifact files with raw `process.cwd()` or context-injected absolute paths. No validation layer strips or relativizes paths before artifact write. The CLAUDE.md instructions do not include path sanitization rules.

### RC-2: Synthetic Task Creation Without Lifecycle Governance
Tasks are created with `source: "manual"` and no sub-agent session linkage, completion criteria, or TTL. They persist indefinitely in `todo`/`inProgress`, never completing and never expiring.

### RC-3: Queue Admission Control Missing
No gate prevents low-value synthetic tasks from entering the active queue. The auto-seed mechanism requires an empty queue (threshold: 0), which never occurs because synthetic tasks occupy all slots. Strategic work cannot be seeded or prioritized.

### RC-4: Priority Enforcement Gap
The growth experiment prioritizer produces correct scores, but scores are not written back into kanban task priority fields. Strategic priority is a document artifact, not an operational constraint.

### RC-5: Urgency Bias in Queue Design
The system treats all `inProgress` tasks equally regardless of source or strategic value. Per the "Mere Urgency Effect" (Zhu, Yang, & Hsee, 2018), systems that surface all tasks as equally urgent cause operators to prioritize visible churn over invisible strategic work. The queue design has no Eisenhower-style quadrant separation.

---

## Remediation Tasks

### RT-1: Output Path Sanitization Gate
**What:** Add a post-write validation function that scans artifact content for absolute local paths and either strips them to relative paths or replaces with `<project-root>/...` tokens.

**Acceptance Criteria:**
- [ ] Function `sanitizeArtifactPaths(content)` exists in a shared utility
- [ ] Regex catches `/Users/`, `/home/`, `/root/`, `C:\Users\`, and `/var/` patterns
- [ ] All artifact-writing scripts call sanitizer before `fs.writeFileSync`
- [ ] Existing 13 affected files are retroactively cleaned
- [ ] Test asserts that `sanitizeArtifactPaths('/Users/foo/bar/data/kanban.json')` returns `data/kanban.json`
- [ ] CLAUDE.md updated with rule: "Never emit absolute local paths in artifacts"

### RT-2: Synthetic Task TTL + Auto-Expiry
**What:** Add a `ttlMinutes` field to kanban tasks. Synthetic tasks (source: `manual`, smoke, lifecycle, integration) get a default TTL of 60 minutes. A sweep script moves expired tasks to `done` with reason `expired-ttl`.

**Acceptance Criteria:**
- [ ] `ttlMinutes` field added to kanban task schema
- [ ] Default TTL: 60min for synthetic, null (no expiry) for `intelligent-iteration` source
- [ ] Sweep script `scripts/kanban-ttl-sweep.js` runs and expires stale synthetic tasks
- [ ] Test validates that a 61-minute-old smoke task is moved to `done`
- [ ] Test validates that strategic tasks are never auto-expired

### RT-3: Queue Admission Control with Strategic Reservation
**What:** Modify task creation to enforce a strategic reservation: at least 30% of active queue slots (todo + inProgress) must be reserved for `intelligent-iteration` source tasks. Synthetic tasks are rejected when the non-strategic queue exceeds 70% capacity.

**Acceptance Criteria:**
- [ ] Queue capacity constant defined (e.g., `MAX_ACTIVE = 20`)
- [ ] Admission check: `if (nonStrategicCount / activeCount > 0.70) reject(syntheticTask)`
- [ ] Auto-seed threshold changed from `activeCount === 0` to `strategicCount < ceil(MAX_ACTIVE * 0.30)`
- [ ] Test: with 15 synthetic tasks active, a 16th synthetic task is rejected
- [ ] Test: with 15 synthetic tasks active, a strategic task is still admitted

### RT-4: Priority Score Writeback from Experiment Prioritizer
**What:** After `pantrypal-growth-experiment-prioritizer.js` scores experiments, write the normalized score back into the corresponding kanban task's `priority` field. Tasks scoring above 70 are set to `high`; 40-70 to `medium`; below 40 to `low`.

**Acceptance Criteria:**
- [ ] Prioritizer outputs `kanbanUpdates[]` array with `{taskId, newPriority}` pairs
- [ ] Kanban write function applies priority updates
- [ ] Test: experiment scoring 79.85 results in kanban task priority = `high`
- [ ] Test: experiment scoring 35 results in kanban task priority = `low`

### RT-5: CLAUDE.md Path Hygiene Rule
**What:** Add explicit instruction to CLAUDE.md preventing local path emission in artifacts.

**Acceptance Criteria:**
- [ ] CLAUDE.md contains rule: `- Never include absolute local filesystem paths (e.g., /Users/*, /home/*) in artifact outputs. Use project-relative paths only.`
- [ ] Rule is in the `## Rules` section
- [ ] Verified that the rule is present and parseable

### RT-6: Retroactive Artifact Cleanup
**What:** Clean the 13 currently-affected artifact files by replacing absolute paths with relative paths.

**Acceptance Criteria:**
- [ ] All 17 leakage instances across 13 files are replaced with relative paths
- [ ] `grep -r '/Users/' artifacts/` returns zero matches post-cleanup
- [ ] No functional breakage in any script that reads these artifacts (paths were metadata-only)

---

## Sources

- [OWASP LLM02:2025 — Sensitive Information Disclosure](https://genai.owasp.org/llmrisk/llm022025-sensitive-information-disclosure/)
- [OWASP Top 10 for LLM Applications 2025 — Examples & Mitigation (Oligo Security)](https://www.oligo.security/academy/owasp-top-10-llm-updated-2025-examples-and-mitigation-strategies)
- [CVE-2026-25593: OpenClaw AI Assistant RCE Vulnerability (SentinelOne)](https://www.sentinelone.com/vulnerability-database/cve-2026-25593/)
- [Data Leakage: AI's Plumbing Problem (CrowdStrike)](https://www.crowdstrike.com/en-us/blog/data-leakage-ai-plumbing-problem/)
- [7 Agentic AI Security Risks 2026 (Moxo)](https://www.moxo.com/blog/agentic-ai-security-risks)
- [AI Agent Vulnerabilities: Understanding Security Risks (WitnessAI)](https://witness.ai/blog/ai-agent-vulnerabilities/)
- [The Tyranny of the Urgent Can Cause Priority Overload (Clemmer Group)](https://www.clemmergroup.com/articles/tyranny-urgent-can-cause-priority-overload/)
- [Managing Priorities: The Mere-Urgency Effect (Medium)](https://medium.com/management-matters/managing-priorities-the-mere-urgency-effect-f347d4afb805)
- [Product Owners Should Prioritize Importance over Urgency (Mountain Goat Software)](https://www.mountaingoatsoftware.com/blog/how-to-ensure-youre-working-on-the-most-important-items-each-iteration)
- [From Backlog Overload to Clear Priorities (Medium)](https://maxim-gorin.medium.com/from-backlog-overload-to-clear-priorities-d56912458845)
- [Eisenhower Matrix: A Product Manager's Guide (Beyond the Backlog)](https://beyondthebacklog.com/2024/11/12/the-eisenhower-matrix/)
- [Product Prioritization Frameworks: Complete Guide 2026 (Monday.com)](https://monday.com/blog/rnd/product-prioritization-frameworks/)
- [A Strategic Framework for How to Prioritize AI Projects (Fountain City)](https://fountaincity.tech/resources/blog/a-strategic-framework-for-how-to-prioritize-ai-projects/)
