# Blocker-Management Compliance Patterns for AI Coding Orchestration

> Deep research brief — 2026-02-28
> Scope: auto-spawn blocker-handler, two-attempt repair policy, escalation gating, auditable proof capture

---

## 1. Problem Statement

AI coding agents operating in autonomous or semi-autonomous loops encounter **blockers** — failures that halt forward progress. Without a disciplined blocker-management compliance layer, agents either:

- **Spin infinitely** retrying the same failing action ([GitHub #4850 — agents spawning sub-agents causing endless loops](https://github.com/anthropics/claude-code/issues/4850))
- **Silently skip** the blocked step, producing incomplete work with no audit trail
- **Escalate everything** to a human, defeating the purpose of autonomy

A compliant blocker-management system must **auto-detect blockers, attempt bounded self-repair, gate escalation to a narrow set of truly-human-required categories, and capture immutable proof of every decision**.

---

## 2. Pattern 1 — Auto-Spawn Blocker-Handler

### 2.1 Concept

When the primary agent encounters a blocker (CI failure, test regression, merge conflict, dependency error), the orchestrator **automatically spawns a specialised handler sub-agent** scoped to that failure class. The primary agent does not block; the handler operates in parallel or takes over the blocked task.

### 2.2 Prior Art

| System | Mechanism | Source |
|--------|-----------|--------|
| **Composio Agent Orchestrator** | YAML `reactions.ci_failed.action: spawn_agent` with `retries: 2` and `escalateAfter: 30m` | [ComposioHQ/agent-orchestrator](https://github.com/ComposioHQ/agent-orchestrator) |
| **Gas Town** | "Mayor" distributes work; "Deacon" monitors health and re-dispatches on failure | [Agentic Handbook — nibzard](https://www.nibzard.com/agentic-handbook) |
| **Claude Code 2.1+ Task System** | `dispatch_agent` (I2A/Task Agent) spawns sub-agents with depth=1 limitation preventing recursive explosion | [Claude Code Agent Architecture — ZenML](https://www.zenml.io/llmops-database/claude-code-agent-architecture-single-threaded-master-loop-for-autonomous-coding) |
| **Ralph Wiggum Pattern** | Autonomous re-feed loop that inspects completion criteria and re-injects prompt with updated context | [Complete Guide to Agentic Coding 2026](https://www.teamday.ai/blog/complete-guide-agentic-coding-2026) |

### 2.3 Design Rules

1. **Depth cap = 1**: Sub-agents MUST NOT spawn further sub-agents. This prevents recursive explosion and OOM ([Claude Code sub-agent docs](https://code.claude.com/docs/en/sub-agents)).
2. **Scoped context injection**: The handler receives only the blocker diagnostic (error logs, diff, failing test output) — not the full conversation history.
3. **Typed action schema**: Handler must return exactly one valid action from a discriminated union (`fix_applied | needs_escalation | blocker_reclassified`). Anything else fails validation and is retried or escalated ([GitHub Blog — Multi-agent workflows](https://github.blog/ai-and-ml/generative-ai/multi-agent-workflows-often-fail-heres-how-to-engineer-ones-that-dont/)).
4. **Spawn budget**: Maximum N concurrent handlers per orchestrator session (prevents fleet explosion).

### 2.4 Pseudocode

```javascript
async function handleBlocker(blocker, context) {
  const handler = spawnSubAgent({
    type: classifyBlocker(blocker),     // "ci_fail" | "test_regress" | "merge_conflict" | "dep_error"
    context: extractDiagnostic(blocker),
    depth: 1,                            // hard cap — no recursive spawning
    timeout: HANDLER_TIMEOUT_MS,
  });

  const result = await handler.execute();

  if (!isValidAction(result)) {
    return { action: "needs_escalation", reason: "invalid_handler_response" };
  }
  return result;
}
```

---

## 3. Pattern 2 — Two-Attempt Repair Policy

### 3.1 Concept

For any given blocker, the agent is allowed **exactly two autonomous repair attempts**. If the second attempt fails, the blocker is classified as non-self-recoverable and routed to escalation. This bounds the retry surface while giving the agent a fair shot at self-repair.

### 3.2 Rationale

- **One attempt** is too aggressive — transient failures and first-try misdiagnoses are common.
- **Three+ attempts** risk the [recursive debugging anti-pattern](https://www.sitepoint.com/recursive-debugging-agent-patterns/) where each attempt compounds state drift.
- **Two attempts** provides one initial attempt + one informed retry (with failure context from attempt 1 injected into attempt 2).

### 3.3 Prior Art

| System | Policy | Source |
|--------|--------|--------|
| **Composio Agent Orchestrator** | `retries: 2` in YAML config per reaction type | [ComposioHQ/agent-orchestrator](https://github.com/ComposioHQ/agent-orchestrator) |
| **Tenacity/retry decorator pattern** | `stop=stop_after_attempt(3)` with exponential backoff (industry standard; we tighten to 2) | [GoCodeo — Error Recovery Strategies](https://www.gocodeo.com/post/error-recovery-and-fallback-strategies-in-ai-agent-development) |
| **OpenCode cancellation loop** | 3 attempts × 120ms, then force-transition (safety net) | [OpenCode Agent docs](https://opencode.ai/docs/agents/) |

### 3.4 Error Classification

Before attempting repair, classify the error to determine if retry is even appropriate:

| Category | Retriable? | Examples |
|----------|-----------|----------|
| **Execution-level** | Yes (attempt 1-2) | Tool invocation failure, connection timeout, transient API error |
| **Semantic** | Yes (attempt 1-2, with context) | Wrong SQL generated, hallucinated API call, incorrect file path |
| **State desync** | Yes (attempt 1 only, then checkpoint) | Agent assumes file exists but it was deleted |
| **Permission / Auth** | **No — escalate immediately** | Missing credentials, insufficient role, sudo required |
| **Secrets / Env** | **No — escalate immediately** | Missing env var, leaked credential detected |

Source: Error classification framework from [GoCodeo](https://www.gocodeo.com/post/error-recovery-and-fallback-strategies-in-ai-agent-development)

### 3.5 Implementation

```javascript
const MAX_REPAIR_ATTEMPTS = 2;

async function repairLoop(blocker, context) {
  // Immediate escalation for non-retriable categories
  if (isEscalationOnly(blocker.category)) {
    return escalate(blocker, "non_retriable_category");
  }

  let lastError = null;

  for (let attempt = 1; attempt <= MAX_REPAIR_ATTEMPTS; attempt++) {
    const proof = createAttemptRecord(blocker, attempt, context);

    try {
      const fix = await handleBlocker(blocker, {
        ...context,
        attempt,
        priorFailure: lastError,       // attempt 2 gets attempt 1's failure context
      });

      if (fix.action === "fix_applied") {
        const verified = await verifyFix(fix, blocker);
        proof.outcome = verified ? "resolved" : "verification_failed";
        await commitProof(proof);

        if (verified) return { status: "resolved", attempts: attempt, proof };
      }

      lastError = fix;
    } catch (err) {
      lastError = err;
      proof.outcome = "exception";
      proof.error = serializeError(err);
      await commitProof(proof);
    }
  }

  // Both attempts exhausted — escalate
  return escalate(blocker, "max_attempts_exhausted", { attempts: MAX_REPAIR_ATTEMPTS, lastError });
}
```

### 3.6 Key Invariant

> **After attempt 2 fails, the agent MUST NOT retry again.** It writes a proof record and escalates. No exceptions.

This prevents the [unbounded refinement loop](https://medium.com/rose-digital/how-to-design-a-human-in-the-loop-agent-flow-without-killing-velocity-fe96a893525e) that is the #1 failure mode in autonomous agent systems.

---

## 4. Pattern 3 — Escalation Gating (Permissions / Auth / Secrets / Sudo Only)

### 4.1 Concept

Not all blockers should reach a human. The escalation gate enforces a **narrow allowlist** of categories that warrant human intervention. Everything else must be handled by the agent's repair loop or flagged as a system failure.

### 4.2 Escalation-Worthy Categories (The Gate)

| Category | Why Human Required | Example |
|----------|-------------------|---------|
| **Permissions** | Agent lacks role/scope; granting requires human authorization | `tickets:admin` needed but agent has `tickets:read` only |
| **Authentication** | Credential expired, MFA required, or OAuth consent needed | Token refresh requires interactive login |
| **Secrets** | Missing env var, vault access denied, or credential detected in output | `.env` file not found; API key in diff output |
| **Sudo / Elevated Privilege** | Action requires root, admin, or owner-level access | `docker build` needs daemon access; DB migration needs DBA role |

### 4.3 Everything Else Stays Internal

| Category | Disposition |
|----------|------------|
| CI test failure | Auto-repair (attempt 1-2), then mark task as blocked |
| Merge conflict | Auto-repair (attempt 1-2), then pause task |
| Dependency resolution | Auto-repair (attempt 1-2), then mark task as blocked |
| Syntax / lint error | Auto-repair (attempt 1-2), never escalate |
| Timeout / rate limit | Backoff + retry, never escalate |
| Agent logic error | Log + abort task, never escalate to human |

### 4.4 Prior Art

| Principle | Source |
|-----------|--------|
| Least-privilege with scoped tokens, time-boxed credentials, file-tree allowlists | [WorkOS — AI Agent Access Control](https://workos.com/blog/ai-agent-access-control) |
| "Do not assign access control responsibility to AI agents — build it into your architecture" | [Oso — Authorizing AI Agents](https://www.osohq.com/learn/best-practices-of-authorizing-ai-agents) |
| Sandbox isolation, command allowlists, gated write permissions | [OpenSSF — Security-Focused Guide for AI Code Assistants](https://best.openssf.org/Security-Focused-Guide-for-AI-Code-Assistant-Instructions) |
| Human approval gates for destructive operations with re-authentication (MFA) | [WorkOS](https://workos.com/blog/ai-agent-access-control) |
| Prevention of tool-chaining privilege escalation | [Knostic — AI Coding Agent Security](https://www.knostic.ai/blog/ai-coding-agent-security) |
| Each agent identity gets minimal, continuously evaluated permissions | [Securing AI Skills — OPS Community](https://community.ops.io/eyalestrin/securing-ai-skills-2aj8) |

### 4.5 Gate Implementation

```javascript
const ESCALATION_CATEGORIES = new Set([
  "permission_denied",
  "auth_expired",
  "auth_mfa_required",
  "secret_missing",
  "secret_leaked",
  "sudo_required",
  "elevated_privilege_needed",
]);

function shouldEscalate(blocker) {
  return ESCALATION_CATEGORIES.has(blocker.category);
}

async function escalate(blocker, reason, meta = {}) {
  const escalation = {
    id: generateUUID(),
    timestamp: new Date().toISOString(),
    blocker_id: blocker.id,
    category: blocker.category,
    reason,
    diagnostic: blocker.diagnostic,
    repair_attempts: meta.attempts || 0,
    last_error: meta.lastError ? serializeError(meta.lastError) : null,
    agent_id: getCurrentAgentId(),
    session_id: getCurrentSessionId(),
    status: "awaiting_human",
  };

  await writeImmutableLog(escalation);
  await notifyHuman(escalation);   // Slack, dashboard, email — configurable
  return { status: "escalated", escalation_id: escalation.id };
}
```

---

## 5. Pattern 4 — Auditable Proof Capture

### 5.1 Concept

Every blocker detection, repair attempt, escalation decision, and resolution must produce an **immutable, structured proof record** that can be audited after the fact. This is both a compliance requirement and an operational necessity for debugging agent behaviour.

### 5.2 Compliance Frameworks Requiring Audit Trails

| Framework | Retention | Key Requirements | Source |
|-----------|-----------|-----------------|--------|
| **SOX** | 7 years | Segregation of duties, authorization chains | [Tetrate — MCP Audit Logging](https://tetrate.io/learn/ai/mcp/mcp-audit-logging) |
| **HIPAA** | 6 years | All PHI access with agent identity + timestamps + purpose | [Tetrate](https://tetrate.io/learn/ai/mcp/mcp-audit-logging) |
| **GDPR** | Varies | Right-to-explanation for automated decisions | [Tetrate](https://tetrate.io/learn/ai/mcp/mcp-audit-logging) |
| **PCI-DSS** | 1 year | Cardholder data access tracking | [Tetrate](https://tetrate.io/learn/ai/mcp/mcp-audit-logging) |
| **ISO 27001** | Org-defined | Comprehensive activity logging for automated systems | [Adopt AI — Audit Trails for Agents](https://www.adopt.ai/glossary/audit-trails-for-agents) |

### 5.3 Proof Record Schema (Agent Decision Record)

```json
{
  "$schema": "blocker-proof/v1",
  "id": "uuid-v4",
  "trace_id": "uuid-v4 — correlates all records in one blocker lifecycle",
  "session_id": "orchestrator session",
  "agent_id": "agent that encountered / handled the blocker",
  "timestamp": "ISO-8601",
  "event_type": "blocker_detected | repair_attempt | repair_verified | escalation_raised | escalation_resolved",
  "blocker": {
    "id": "uuid-v4",
    "category": "ci_fail | test_regress | merge_conflict | permission_denied | auth_expired | secret_missing | ...",
    "diagnostic": "structured error payload — stderr, exit code, failing test name",
    "source_file": "optional — file path that triggered the blocker",
    "source_line": "optional — line number"
  },
  "attempt": {
    "number": 1,
    "max": 2,
    "strategy": "description of repair strategy used",
    "diff": "optional — patch applied",
    "prior_failure_context": "injected from attempt N-1"
  },
  "outcome": "resolved | verification_failed | exception | escalated",
  "verification": {
    "method": "test_rerun | ci_rerun | lint_check | manual",
    "passed": true,
    "evidence_ref": "path or URL to test output / CI log"
  },
  "escalation": {
    "reason": "non_retriable_category | max_attempts_exhausted",
    "human_notified": true,
    "channel": "slack | dashboard | email",
    "resolved_by": "human identity (filled post-resolution)",
    "resolution_timestamp": "ISO-8601 (filled post-resolution)"
  },
  "integrity": {
    "hash": "SHA-256 of this record",
    "prev_hash": "SHA-256 of previous record in chain — enables tamper detection"
  }
}
```

Source: Schema design synthesised from [Adopt AI — Audit Trails](https://www.adopt.ai/glossary/audit-trails-for-agents), [Tetrate — MCP Audit Logging](https://tetrate.io/learn/ai/mcp/mcp-audit-logging), and [Prefactor — Audit Trails in CI/CD](https://prefactor.tech/blog/audit-trails-in-ci-cd-best-practices-for-ai-agents).

### 5.4 Storage Requirements

| Requirement | Implementation | Source |
|------------|---------------|--------|
| **Immutability** | Append-only storage; S3 Object Lock / GCS retention | [Adopt AI](https://www.adopt.ai/glossary/audit-trails-for-agents) |
| **Hash chaining** | Each record includes SHA-256 of previous record | [Tetrate](https://tetrate.io/learn/ai/mcp/mcp-audit-logging) |
| **Tiered retention** | Hot (queryable) → warm (aged) → cold (archived) | [Tetrate](https://tetrate.io/learn/ai/mcp/mcp-audit-logging) |
| **Encryption** | At rest + in transit; separate keys by sensitivity | [Tetrate](https://tetrate.io/learn/ai/mcp/mcp-audit-logging) |
| **Access control** | Need-to-know; audit all log access | [Tetrate](https://tetrate.io/learn/ai/mcp/mcp-audit-logging) |
| **Sensitive data redaction** | Log metadata (field count, redaction markers) not raw values | [Tetrate](https://tetrate.io/learn/ai/mcp/mcp-audit-logging) |

---

## 6. Implementation Playbook

### Phase 1 — Blocker Classifier (Week 1)

1. Define the blocker taxonomy enum: `ci_fail`, `test_regress`, `merge_conflict`, `dep_error`, `lint_error`, `timeout`, `permission_denied`, `auth_expired`, `auth_mfa_required`, `secret_missing`, `secret_leaked`, `sudo_required`, `elevated_privilege_needed`, `unknown`.
2. Implement `classifyBlocker(error)` function that maps raw errors to taxonomy categories using pattern matching on exit codes, stderr patterns, and error message signatures.
3. Write the `isEscalationOnly(category)` gate check against the escalation allowlist.
4. Unit test: every category maps correctly; unknown errors default to `unknown` (retriable).

### Phase 2 — Proof Record System (Week 1-2)

1. Implement the proof record JSON schema (Section 5.3).
2. Build `createAttemptRecord()`, `commitProof()`, and `writeImmutableLog()` functions.
3. Implement hash-chaining: each record includes `SHA-256(previous_record)`.
4. Storage backend: start with append-only local JSON file (one per session), graduate to cloud immutable storage.
5. Add `verifyChainIntegrity(logFile)` for post-hoc tamper detection.

### Phase 3 — Two-Attempt Repair Loop (Week 2)

1. Implement the `repairLoop()` function (Section 3.5).
2. Wire in the blocker-handler sub-agent spawner (Section 2.4).
3. Ensure attempt 2 receives attempt 1's failure context via `priorFailure` injection.
4. Implement `verifyFix()` — re-runs the check that originally failed (test, CI, lint).
5. Wire proof capture into every branch of the repair loop.

### Phase 4 — Escalation Gate (Week 2-3)

1. Implement `shouldEscalate()` gate (Section 4.5).
2. Build `escalate()` function with notification channel abstraction.
3. Ensure escalation records include full repair attempt history.
4. Add dashboard / Slack integration for human notification.
5. Implement `resolveEscalation()` for humans to close the loop with resolution evidence.

### Phase 5 — Integration & Hardening (Week 3-4)

1. Wire all components into the orchestrator's main agent loop.
2. Add circuit breaker: if >N blockers hit in T seconds, pause all agent work and alert.
3. Add spawn budget enforcement (max concurrent handlers).
4. End-to-end integration tests with simulated blockers.
5. Load test: verify no OOM under rapid blocker generation.

---

## 7. Acceptance Criteria & Tests

### AC-1: Auto-Spawn Blocker-Handler

| # | Criterion | Test |
|---|-----------|------|
| 1.1 | When a CI failure blocker is detected, a handler sub-agent is spawned within 2s | `test_auto_spawn_on_ci_failure()` — inject CI failure event, assert handler spawned, measure latency < 2000ms |
| 1.2 | Handler sub-agents cannot spawn further sub-agents (depth cap = 1) | `test_depth_cap_enforced()` — handler attempts to call `spawnSubAgent()`, assert it throws `DepthLimitExceeded` |
| 1.3 | Handler returns exactly one valid action from the discriminated union | `test_handler_returns_valid_action()` — run handler on known blocker, assert result matches `fix_applied \| needs_escalation \| blocker_reclassified` |
| 1.4 | Max concurrent handler budget is enforced | `test_spawn_budget_limit()` — trigger N+1 simultaneous blockers where budget=N, assert Nth+1 is queued not spawned |

### AC-2: Two-Attempt Repair Policy

| # | Criterion | Test |
|---|-----------|------|
| 2.1 | Retriable blockers get exactly 2 repair attempts | `test_two_attempts_on_retriable()` — inject retriable blocker with permanent failure, assert exactly 2 `repair_attempt` proof records exist |
| 2.2 | Attempt 2 receives attempt 1's failure context | `test_prior_failure_injected()` — mock handler, assert attempt 2 invocation includes `priorFailure` from attempt 1 |
| 2.3 | After attempt 2 fails, agent does NOT retry again | `test_no_third_attempt()` — inject permanent failure, assert no 3rd attempt record, assert escalation raised |
| 2.4 | Successful attempt 1 short-circuits (no attempt 2) | `test_early_resolution()` — inject blocker that handler fixes on attempt 1, assert only 1 attempt record, outcome = "resolved" |
| 2.5 | Fix verification runs after each successful repair | `test_verification_runs()` — handler returns `fix_applied`, assert `verifyFix()` is called, assert verification result in proof record |

### AC-3: Escalation Gating

| # | Criterion | Test |
|---|-----------|------|
| 3.1 | Permission/auth/secret/sudo blockers escalate immediately (0 repair attempts) | `test_immediate_escalation_categories()` — for each of `permission_denied`, `auth_expired`, `secret_missing`, `sudo_required`: inject blocker, assert 0 repair attempts, assert escalation raised |
| 3.2 | Non-gated categories never escalate after 2 failed attempts — they mark task as blocked | `test_non_gated_no_escalation()` — inject `lint_error` with permanent failure, assert after 2 attempts task is marked `blocked` not `escalated` |
| 3.3 | Escalation record includes full repair attempt history | `test_escalation_includes_history()` — inject retriable blocker that fails twice then escalates, assert escalation record contains `repair_attempts: 2` and `last_error` |
| 3.4 | Human notification fires on escalation | `test_human_notified()` — mock notification channel, assert `notifyHuman()` called with escalation payload |
| 3.5 | Escalation resolution closes the loop with evidence | `test_escalation_resolution()` — call `resolveEscalation()` with human identity + resolution, assert record updated with `resolved_by` and `resolution_timestamp` |

### AC-4: Auditable Proof Capture

| # | Criterion | Test |
|---|-----------|------|
| 4.1 | Every blocker detection produces a proof record | `test_proof_on_detection()` — inject any blocker, assert `blocker_detected` event record exists with all required fields |
| 4.2 | Every repair attempt produces a proof record | `test_proof_on_attempt()` — run repair loop, assert N `repair_attempt` records with correct attempt numbers |
| 4.3 | Every escalation produces a proof record | `test_proof_on_escalation()` — trigger escalation, assert `escalation_raised` event record exists |
| 4.4 | Proof records are hash-chained | `test_hash_chain_integrity()` — generate 5+ records, run `verifyChainIntegrity()`, assert passes; tamper with one record, assert fails |
| 4.5 | Proof records are append-only (no mutation of prior records) | `test_immutability()` — attempt to update a committed record, assert write is rejected |
| 4.6 | Sensitive data is redacted in proof records | `test_redaction()` — inject blocker with API key in stderr, assert proof record contains `[REDACTED]` not the key |
| 4.7 | 100% of agent actions produce log entries (no silent drops) | `test_completeness()` — run full repair-loop-to-escalation flow, assert `count(proof_records) == expected_count` for every code path |

### AC-5: End-to-End Integration

| # | Criterion | Test |
|---|-----------|------|
| 5.1 | Full happy path: blocker → attempt 1 fix → verify → resolved | `test_e2e_happy_path()` — simulate test failure, handler fixes it, verification passes, proof chain complete |
| 5.2 | Full escalation path: blocker → attempt 1 fail → attempt 2 fail → escalate | `test_e2e_escalation_path()` — simulate permanent failure, both attempts fail, escalation fires with full history |
| 5.3 | Auth blocker skips repair and escalates immediately with proof | `test_e2e_auth_escalation()` — simulate `auth_expired`, assert 0 attempts, immediate escalation, proof record chain complete |
| 5.4 | No OOM under rapid blocker generation (100 blockers in 10s) | `test_e2e_load()` — fire 100 blockers rapidly, assert memory stays under threshold, all proof records written |
| 5.5 | Circuit breaker activates when blocker rate exceeds threshold | `test_e2e_circuit_breaker()` — fire blockers above rate threshold, assert all agent work paused, alert emitted |

---

## 8. Configuration Reference

```yaml
# blocker-management.yaml
blocker_handler:
  spawn_timeout_ms: 30000
  max_concurrent_handlers: 5
  depth_cap: 1

repair_policy:
  max_attempts: 2
  backoff_ms: [1000, 3000]          # attempt 1 wait, attempt 2 wait
  inject_prior_failure: true

escalation_gate:
  categories:
    - permission_denied
    - auth_expired
    - auth_mfa_required
    - secret_missing
    - secret_leaked
    - sudo_required
    - elevated_privilege_needed
  notification_channels:
    - type: slack
      webhook_url: "${SLACK_ESCALATION_WEBHOOK}"
    - type: dashboard
      endpoint: "${DASHBOARD_API_URL}/escalations"

proof_capture:
  storage: local_append_only         # or: s3_object_lock, gcs_retention
  hash_algorithm: sha256
  chain_records: true
  redaction_patterns:
    - "(?i)(api[_-]?key|secret|password|token)\\s*[:=]\\s*\\S+"
    - "(?i)bearer\\s+\\S+"
  retention_days: 2555                # ~7 years (SOX compliance)
  output_dir: "./artifacts/blocker-proofs"

circuit_breaker:
  max_blockers_per_window: 10
  window_seconds: 60
  action: pause_all_agents
```

---

## 9. Architecture Diagram (ASCII)

```
┌─────────────────────────────────────────────────────────┐
│                   ORCHESTRATOR LOOP                      │
│                                                         │
│  Agent Work ──→ BLOCKER DETECTED                        │
│                      │                                  │
│                      ▼                                  │
│               ┌─────────────┐                           │
│               │  CLASSIFY   │                           │
│               │  BLOCKER    │                           │
│               └──────┬──────┘                           │
│                      │                                  │
│            ┌─────────┴──────────┐                       │
│            │                    │                       │
│     Retriable?            Escalation-only?              │
│            │                    │                       │
│            ▼                    ▼                       │
│   ┌────────────────┐   ┌───────────────┐               │
│   │ REPAIR LOOP    │   │ ESCALATE      │               │
│   │ (max 2 tries)  │   │ IMMEDIATELY   │               │
│   │                │   │               │               │
│   │ Attempt 1      │   │ • Write proof │               │
│   │   ↓ fail?      │   │ • Notify human│               │
│   │ Attempt 2      │   │ • Await       │               │
│   │   ↓ fail?      │   │   resolution  │               │
│   │ → Escalate OR  │   └───────────────┘               │
│   │   Mark blocked │           ▲                       │
│   └────────┬───────┘           │                       │
│            │                   │                       │
│            └───────────────────┘                       │
│                      │                                  │
│                      ▼                                  │
│            ┌─────────────────┐                          │
│            │  PROOF CAPTURE  │                          │
│            │  (every branch) │                          │
│            │                 │                          │
│            │ • Hash-chained  │                          │
│            │ • Append-only   │                          │
│            │ • Redacted      │                          │
│            └─────────────────┘                          │
└─────────────────────────────────────────────────────────┘
```

---

## 10. Sources

1. [ComposioHQ/agent-orchestrator — GitHub](https://github.com/ComposioHQ/agent-orchestrator) — YAML-driven auto-spawn, retry, and escalation config
2. [Claude Code Agent Architecture — ZenML](https://www.zenml.io/llmops-database/claude-code-agent-architecture-single-threaded-master-loop-for-autonomous-coding) — Depth-limited sub-agent spawning
3. [Claude Code Sub-Agent Documentation](https://code.claude.com/docs/en/sub-agents) — Depth cap enforcement
4. [GitHub Blog — Multi-agent workflows often fail](https://github.blog/ai-and-ml/generative-ai/multi-agent-workflows-often-fail-heres-how-to-engineer-ones-that-dont/) — Typed action schemas, failure-first design
5. [GoCodeo — Error Recovery and Fallback Strategies](https://www.gocodeo.com/post/error-recovery-and-fallback-strategies-in-ai-agent-development) — Error classification, bounded retry, escalation
6. [Recursive Debugging Agent Pattern — SitePoint](https://www.sitepoint.com/recursive-debugging-agent-patterns/) — Bounded retry with safety rails
7. [Human-in-the-Loop Agent Flow — Medium/Rose Digital](https://medium.com/rose-digital/how-to-design-a-human-in-the-loop-agent-flow-without-killing-velocity-fe96a893525e) — Escalation thresholds without killing velocity
8. [WorkOS — AI Agent Access Control](https://workos.com/blog/ai-agent-access-control) — RBAC, least privilege, credential scoping, human approval gates
9. [Oso — Best Practices of Authorizing AI Agents](https://www.osohq.com/learn/best-practices-of-authorizing-ai-agents) — Architecture-level access control
10. [OpenSSF — Security-Focused Guide for AI Code Assistants](https://best.openssf.org/Security-Focused-Guide-for-AI-Code-Assistant-Instructions) — Sandbox isolation, command allowlists, gated write permissions
11. [Knostic — AI Coding Agent Security](https://www.knostic.ai/blog/ai-coding-agent-security) — Tool-chaining privilege escalation prevention
12. [Tetrate — MCP Audit Logging](https://tetrate.io/learn/ai/mcp/mcp-audit-logging) — Compliance frameworks, structured logging, distributed tracing, immutable storage
13. [Adopt AI — Audit Trails for Agents](https://www.adopt.ai/glossary/audit-trails-for-agents) — Agent Decision Records, immutable logging, hash chaining
14. [Prefactor — Audit Trails in CI/CD for AI Agents](https://prefactor.tech/blog/audit-trails-in-ci-cd-best-practices-for-ai-agents) — JSON event schema standardisation
15. [Agentic Handbook — nibzard](https://www.nibzard.com/agentic-handbook) — Gas Town Mayor/Deacon orchestration pattern
16. [Complete Guide to Agentic Coding 2026 — TeamDay](https://www.teamday.ai/blog/complete-guide-agentic-coding-2026) — Ralph Wiggum autonomous loop pattern
17. [GitHub #4850 — Agent spawning endless loop bug](https://github.com/anthropics/claude-code/issues/4850) — Why depth caps are mandatory
18. [Knostic — AI Coding Assistant Governance](https://www.knostic.ai/blog/ai-coding-assistant-governance) — Governance frameworks for AI coding tools
19. [Brian Gershon — Securing AI Coding Tools](https://www.briangershon.com/blog/securing-ai-coding-tools/) — Permission controls and credential protection
20. [Composio — Secure AI Agent Infrastructure Guide 2026](https://composio.dev/blog/secure-ai-agent-infrastructure-guide) — Auth-to-action security pipeline
