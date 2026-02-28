# Quality Drift Research: Agent Stalls & Correction Logging Failures

> Generated 2026-02-28 | OpsHub/OpenClaw quality-drift investigation

---

## 1. Findings

### 1A. Agent Waiting-for-Instruction Stalls

**What happens**: Autonomous agents enter an idle state where they stop executing and wait for a human prompt that never comes. In headless/remote contexts this manifests as a silent hang with no recovery path short of a process restart.

**Industry evidence (2025-2026)**:

| Pattern | Description | Observed In |
|---------|-------------|-------------|
| **Tool-hang deadlock** | A tool call (e.g. shell execution) times out but the session is never marked idle. Subsequent tool calls queue behind the hung session, creating a permanent stall. | Agent Zero #1011, Claude Code #28482 |
| **Repeat-detection lockout** | When an agent produces an identical response twice, repeat-detection logic skips tool execution entirely, creating a loop where the agent can never make progress. | Agent Zero #320, #1011 |
| **Service-worker timeout** | Browser-based agent runners kill the service worker after ~30s of inactivity, breaking fire-and-forget autonomous workflows. | Claude Code #15239 |
| **Goal exhaustion stall** | Agent reaches a logical "done" state or prompts for input, then stops — with no keepalive or re-injection mechanism to continue autonomous work. | Claude Code #4766, Ralph Wiggum Loop docs |
| **Stale in-progress pile-up** | Tasks remain stuck in `inProgress` because there is no runtime session to reconcile against, and no timeout moves them back. | OpsHub `inprogress-stale-cleanup.js` (local) |

**Scale of impact**: Gartner projects >40% of agentic AI projects will be cancelled by end-2027, with stalling/reliability as a top cited barrier. 89% of organizations have implemented some form of agent observability, but quality issues remain the #1 production barrier (32% of orgs).

### 1B. Correction Logging Failures

**What happens**: When an agent self-corrects — retries a tool call, revises output, backtracks on a plan — the correction event and its rationale are silently dropped from the audit trail. Downstream, this makes it impossible to distinguish "worked first try" from "failed three times then recovered."

**Industry evidence**:

| Failure Mode | Description | Source |
|-------------|-------------|--------|
| **Flat log blindness** | Standard logging captures events but not causal chains. A retry looks identical to an initial attempt; corrections vanish into the same log stream as successes. | Elementor Engineers (Medium, 2025) |
| **Missing cognitive surface** | Most agent frameworks instrument *operational* events (API calls, tool invocations) but not *cognitive* events (reasoning, plan revision, self-correction). | AgentTrace paper (arXiv 2602.10133) |
| **Nondeterministic output masking** | Identical inputs produce different outputs; logs capture the final result but not the behavioral shift that led to it. | Patronus AI LLM Observability guide |
| **Compounding error momentum** | Without correction logs, a wrong assumption early in a chain compounds — each subsequent decision builds on the error, creating "error momentum" invisible to monitoring. | AI Spaces failure patterns article |
| **Silent degradation** | Performance decays subtly (slower, less helpful, more generic) without triggering any alerts; teams only notice when users complain weeks later. | AI Spaces failure patterns article |

---

## 2. Root Causes

### RC-1: No idle/stall heartbeat
Agent runtimes lack a periodic heartbeat that asserts "I am actively making progress." Without one, the system cannot distinguish "thinking" from "stalled."

### RC-2: Tool-timeout does not reset session state
When a tool call exceeds its timeout, the error is returned to the LLM but the session/shell is never marked idle. All subsequent tool calls queue behind the hung session.

### RC-3: Repeat-detection suppresses tool execution
Loop-detection heuristics (designed to prevent runaway loops) over-correct by skipping the *next* tool call when a repeated message is detected, creating a deadlock instead of preventing one.

### RC-4: No structured schema for correction events
Existing logging captures `start → complete` but not `start → fail → retry → succeed`. The correction arc is invisible because there is no event type for "self-correction" or "plan revision."

### RC-5: Cognitive telemetry is absent
Operational spans (HTTP calls, DB queries) are instrumented via OpenTelemetry auto-instrumentation, but reasoning steps, plan changes, and confidence shifts are not emitted as spans — making the agent's decision process opaque.

### RC-6: No dead-letter / quarantine for stuck tasks
When a task stalls, it stays in `inProgress` indefinitely. There is no dead-letter mechanism to quarantine it after N minutes of inactivity, alert an operator, and attempt recovery.

---

## 3. Remediation Tasks

### RT-1: Implement agent heartbeat with stall detection

**Description**: Add a periodic heartbeat emitted by the agent runtime during active execution. A watchdog monitors heartbeats; if none arrives within `stall_timeout_ms`, the agent is declared stalled and recovery is initiated.

**Acceptance criteria**:
- Agent emits heartbeat every `heartbeat_interval_ms` (default: 10s) while actively executing
- Watchdog declares stall after `stall_timeout_ms` (default: 60s) with no heartbeat
- On stall detection: (a) log structured `agent.stall` event with last-known state, (b) attempt session reset, (c) if reset fails, move task to quarantine column
- Unit test: simulate tool hang > 60s → verify stall event emitted and task quarantined

### RT-2: Fix tool-timeout session reset

**Description**: Ensure all tool-call timeout paths invoke session idle marking, so the agent can issue subsequent tool calls after a timeout.

**Acceptance criteria**:
- Every tool timeout handler calls `markSessionIdle()` (or equivalent) before returning the timeout error to the LLM
- Subsequent tool calls after a timeout succeed without manual intervention
- Integration test: tool call times out → next tool call executes normally (no hang)

### RT-3: Replace destructive repeat-detection with loop-breaker

**Description**: Replace the current repeat-detection logic (which skips tool execution) with a non-destructive loop-breaker that (a) still executes tools, (b) increments a repeat counter, and (c) triggers escalation after N repeats.

**Acceptance criteria**:
- Repeat detection never suppresses tool execution
- After `max_repeats` (default: 3) consecutive identical responses, agent emits `agent.loop_detected` event and either: injects a disambiguation prompt, or escalates to operator
- Sliding window of last 10 tool-call hashes detects near-duplicate loops (hash tool name + truncated args)
- Test: 4 identical responses in sequence → loop event emitted, tool calls still executed

### RT-4: Add correction-event schema to structured logging

**Description**: Define and instrument a `correction` event type in the agent's structured logging schema that captures self-correction arcs.

**Acceptance criteria**:
- New event schema: `{ type: "correction", traceId, spanId, timestamp, original: { action, result, error }, corrected: { action, result }, reason: string, attemptNumber: int }`
- Agent emits `correction` event whenever it retries a failed tool call with different parameters, revises a plan after negative feedback, or backtracks on a previous decision
- Events are queryable: "show all corrections in trace X" returns ordered correction chain
- Test: simulate tool failure → retry with different params → verify correction event logged with both original and corrected payloads

### RT-5: Instrument cognitive telemetry spans

**Description**: Emit OpenTelemetry-compatible spans for cognitive events (reasoning steps, plan revisions, confidence assessments) alongside existing operational spans.

**Acceptance criteria**:
- Three new span types following OTel GenAI semantic conventions: `gen_ai.agent.think` (reasoning step), `gen_ai.agent.plan` (plan creation/revision), `gen_ai.agent.correct` (self-correction)
- Each span carries attributes: `gen_ai.agent.reasoning_text`, `gen_ai.agent.plan_delta`, `gen_ai.agent.confidence_score`
- Spans are causally linked to parent operational spans via shared trace context
- Dual output: JSONL for local inspection + OTel export for distributed tracing backends
- Test: agent performs plan → revise → execute → verify 3 distinct span types emitted in correct causal order

### RT-6: Implement dead-letter quarantine for stuck tasks

**Description**: Add an automated dead-letter mechanism that moves tasks from `inProgress` to a `quarantine` column after configurable inactivity.

**Acceptance criteria**:
- Configurable `quarantine_after_minutes` (default: 20) — tasks with no heartbeat/update beyond this threshold are moved to quarantine
- Quarantined tasks retain full state (logs, last action, error context) for post-mortem
- Activity log entry with type `task_quarantined` records: task ID, stale duration, last known state
- Dashboard exposes quarantine count and age distribution
- Automated retry: quarantined tasks can be re-enqueued with a single command (`--retry-quarantined`)
- Builds on existing `inprogress-stale-cleanup.js` — extend rather than replace
- Test: task with no update for 21 minutes → verify moved to quarantine with complete state preserved

### RT-7: Deploy quality-drift monitoring dashboard

**Description**: Create an observability dashboard tracking key quality-drift indicators across agent sessions.

**Acceptance criteria**:
- Dashboard tracks: stall rate (stalls / total sessions), correction rate (corrections / total actions), loop detection rate, quarantine throughput, mean time to recovery (MTTR) from stall
- Alerts fire when: stall rate > 5%, correction rate spikes > 2x baseline, quarantine queue depth > 10
- Historical trend view (7d / 30d) to detect silent degradation
- Data sourced from structured events (RT-1, RT-3, RT-4, RT-6)

---

## 4. Sources

- [Agent Zero #1011: Stuck in repeat loop after tool hang](https://github.com/agent0ai/agent-zero/issues/1011)
- [Agent Zero #320: "You have sent the same message again" loop](https://github.com/agent0ai/agent-zero/issues/320)
- [Claude Code #4766: Agent stops, must manually prompt to continue](https://github.com/anthropics/claude-code/issues/4766)
- [Claude Code #15239: Service worker idle timeout breaks autonomous workflows](https://github.com/anthropics/claude-code/issues/15239)
- [Claude Code #28482: Agent hangs indefinitely mid-task](https://github.com/anthropics/claude-code/issues/28482)
- [How to Prevent Infinite Loops and Spiraling Costs in Autonomous Agent Deployments](https://codieshub.com/for-ai/prevent-agent-loops-costs)
- [The Failure Patterns Every Agentic AI Team Eventually Hits](https://aispaces.substack.com/p/the-failure-patterns-every-agentic)
- [AgentTrace: A Structured Logging Framework for Agent System Observability (arXiv)](https://arxiv.org/html/2602.10133)
- [OpenTelemetry: AI Agent Observability — Evolving Standards](https://opentelemetry.io/blog/2025/ai-agent-observability/)
- [OTel Semantic Conventions for GenAI Agent Spans](https://opentelemetry.io/docs/specs/semconv/gen-ai/gen-ai-agent-spans/)
- [Why Logging Isn't Enough for LLM Systems (Elementor Engineers)](https://medium.com/elementor-engineers/why-logging-isnt-enough-for-llm-systems-and-how-observability-fixes-it-018e528e9f89)
- [LLM Observability for Multi-Agent Systems (Arpit Chaukiyal)](https://medium.com/@arpitchaukiyal/llm-observability-for-multi-agent-systems-part-1-tracing-and-logging-what-actually-happened-c11170cd70f9)
- [The Complete Guide to LLM Observability for 2026 (Portkey)](https://portkey.ai/blog/the-complete-guide-to-llm-observability/)
- [Audit Logging for AI: What Should You Track (Pranav Prakash)](https://medium.com/@pranavprakash4777/audit-logging-for-ai-what-should-you-track-and-where-3de96bbf171b)
- [A Practical Guide to Monitoring and Controlling Agentic Applications (Fiddler AI)](https://www.fiddler.ai/blog/monitoring-controlling-agentic-applications)
- [Building Reliable Tool Calling in AI Agents with Message Queues (Inferable)](https://www.inferable.ai/blog/posts/distributed-tool-calling-message-queues)
- [Why Most Agentic AI Projects Stall Before They Scale (CIO)](https://www.cio.com/article/4132031/why-most-agentic-ai-projects-stall-before-they-scale.html)
- [Agentic Resource Exhaustion: The Infinite Loop Attack (InstaTunnel)](https://medium.com/@instatunnel/agentic-resource-exhaustion-the-infinite-loop-attack-of-the-ai-era-76a3f58c62e3)
- [IBM: Why Observability is Essential for AI Agents](https://www.ibm.com/think/insights/ai-agent-observability)
- [AG2 OpenTelemetry Tracing for Multi-Agent Systems](https://docs.ag2.ai/latest/docs/blog/2026/02/08/AG2-OpenTelemetry-Tracing/)
