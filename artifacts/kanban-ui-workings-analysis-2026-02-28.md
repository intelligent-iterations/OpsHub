# OpsHub Kanban UI + Workings Analysis (2026-02-28)

## Executive summary
The board architecture works for basic task tracking, but current behavior allows automation-generated noise to overwhelm real work. The biggest failures are not visual design—they are workflow integrity controls.

Top issues:
1. Synthetic task flood can outpace real execution.
2. No hard schema gate for task creation quality.
3. Inconsistent lifecycle enforcement (tasks can be moved without strong completion contract).
4. Reporting layer can amplify bad board state instead of protecting signal.
5. Board health metrics exist but are not used as hard admission guards.

---

## What is working
- Core kanban data model is simple and auditable (`columns`, `activityLog`).
- API layer supports lifecycle hooks and blocker-protocol helpers.
- There are existing guardrail scripts for priority, stale cleanup, TTL sweep, and manager-loop KPIs.
- Done tasks can include verification metadata + GitHub evidence links.

---

## Current pain points (and what to fix)

### 1) Synthetic task ingestion is too permissive (highest priority)
**Observed symptom:** board repeatedly repopulates with placeholders (smoke/lifecycle/integration dashboard/closeout reminder style cards), causing throughput collapse.

**Fixes:**
- Add a strict task-admission validator in API create/move paths:
  - Reject title patterns in a denylist for production mode.
  - Reject empty/placeholder descriptions unless `source=intelligent-iteration` and acceptance criteria exist.
  - Reject duplicate `(normalized_name + normalized_description)` within active columns.
- Introduce `boardMode=production|diagnostic` and only allow synthetic tasks in `diagnostic` mode.
- Add signed source provenance (`source`, `originScript`, `runId`) to every created card; reject unknown automation sources.

### 2) Lifecycle transitions need stronger contracts
**Observed symptom:** tasks can bounce states without meaningful evidence or clear ownership.

**Fixes:**
- Enforce required fields before move to `done`:
  - `completionDetails` with GitHub link(s)
  - `verification.command`, `verification.result=pass`, `verifiedAt`
- Enforce `claimedBy`, `startedAt`, and `updatedAt` for `inProgress`.
- Auto-revert illegal transitions (`done` without verification -> `inProgress` + policy violation log).

### 3) In-progress WIP has no hard cap
**Observed symptom:** in-progress queue can balloon and become meaningless.

**Fixes:**
- Add configurable WIP limit (global + per-priority).
- When exceeded, auto-block new moves to `inProgress` unless task is `critical`.
- Add `oldestInProgressSlaMinutes` enforcement with auto-triage.

### 4) Reporting should be quality-gated, not just event-driven
**Observed symptom:** Slack reporting can mirror bad state and create noise.

**Fixes:**
- Report only tasks that pass `isReportableDone` contract.
- Add anti-spam cooldown and batch summaries.
- Add "board quality status" header to each update (healthy/degraded).

### 5) Duplicate and stale controls should be core API logic
**Observed symptom:** cleanup depends too much on ad-hoc scripts.

**Fixes:**
- Move duplicate detection + stale sweep into server-side write pipeline.
- Keep scripts for remediation, but enforce invariants in API itself.

---

## UI-specific improvements
1. Add a "Board Health" panel (live):
   - duplicate ratio
   - synthetic ratio
   - inProgress count vs WIP cap
   - stale task count
2. Add card badges:
   - `real` / `synthetic` / `quarantined`
   - `verified` / `unverified`
3. Add one-click ops actions in UI:
   - purge synthetic
   - dedupe active columns
   - requeue stale in-progress
4. Add filter presets:
   - Real delivery only
   - Needs verification
   - Blocker compliance required

---

## Implementation plan (fast)

### Phase 1 (same day)
- Add admission validator + denylist + duplicate guard in API.
- Add done-transition hard contract gate.
- Add WIP cap enforcement.

### Phase 2 (1 day)
- Add board health endpoint + UI panel.
- Add reportability filter for Slack updates.

### Phase 3 (1–2 days)
- Add source provenance signing and production/diagnostic board modes.
- Add policy tests for all lifecycle/admission constraints.

---

## Success criteria
- Synthetic tasks in production mode: **0**
- Duplicate active tasks: **0**
- Done without verification: **0**
- inProgress count remains under WIP cap >95% of time
- Slack status signal-to-noise materially improved (no placeholder task spam)
