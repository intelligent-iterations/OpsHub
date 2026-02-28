## OpenClaw Quality Drift — Root Causes

### Waiting-for-Instruction Stalls

| # | Root Cause | Mechanism | Source |
|---|-----------|-----------|--------|
| RC-1 | **No idle/stall heartbeat** | Runtime lacks periodic "I am progressing" assertion — system can't distinguish thinking from stalled | `artifacts/qdrift-claude-research-exec-observability.md` |
| RC-2 | **Tool-timeout doesn't reset session state** | Tool call exceeds timeout → error returned to LLM, but session never marked idle → all subsequent calls queue behind hung session | Agent Zero [#1011](https://github.com/frdel/agent-zero/issues/1011), Claude Code [#28482](https://github.com/anthropics/claude-code/issues/28482) |
| RC-3 | **Repeat-detection suppresses tool execution** | Loop-detection heuristic detects identical response → skips next tool call entirely → permanent deadlock instead of loop prevention | Agent Zero [#320](https://github.com/frdel/agent-zero/issues/320) |
| RC-4 | **No dead-letter / quarantine for stuck tasks** | Stalled tasks stay in `inProgress` indefinitely; no timeout to quarantine, alert, or attempt recovery | OpsHub audit: 83/86 in-progress tasks stale (96%) |
| RC-5 | **Goal-exhaustion stall** | Agent reaches "done" or prompts for input, then stops with no keepalive/re-injection to resume autonomous work | Claude Code [#4766](https://github.com/anthropics/claude-code/issues/4766) |
| RC-6 | **Service-worker timeout** | Browser-based agent runner kills worker after ~30s inactivity → breaks autonomous workflows silently | Claude Code [#15239](https://github.com/anthropics/claude-code/issues/15239) |

**Scale**: 44 stalledWorker tasks detected in single audit; Gartner projects >40% of agentic AI projects cancelled by end-2027 citing stall/reliability as top barrier.

---

### Missed Correction Logging

| # | Root Cause | Mechanism | Source |
|---|-----------|-----------|--------|
| RC-1 | **No structured schema for correction events** | Logging captures `start → complete` but not `start → fail → retry → succeed`; no event type for "self-correction" or "plan revision" | `artifacts/qdrift-claude-research-exec-observability.md` |
| RC-2 | **Cognitive telemetry is absent** | Operational spans (HTTP, DB) auto-instrumented via OpenTelemetry; reasoning steps, plan changes, confidence shifts are NOT emitted as spans | [AgentTrace (arXiv 2602.10133)](https://arxiv.org/abs/2602.10133) |
| RC-3 | **Flat log blindness** | Standard logging captures events but not causal chains — corrections vanish into same stream as successes | [Elementor Engineers (Medium)](https://medium.com/elementor-engineers) |
| RC-4 | **Nondeterministic output masking** | Identical inputs → different outputs; logs show final result but not the behavioral shift that produced it | Patronus AI LLM Observability |
| RC-5 | **Compounding error momentum** | Without correction logs, early wrong assumptions compound invisibly through subsequent decisions — silent degradation | AI Spaces failure patterns |

**Evidence**: QDRIFT-03 test task `qa-001` — correction occurred but `MISSING_CORRECTION_LOG` (ERROR) and `MISSING_VERIFICATION_RECORD` (ERROR) both flagged. Task rolled back from Done → inProgress.

---

### Remediation Status

| Task | Description | Status |
|------|-------------|--------|
| QDRIFT-01 | Start-handshake state machine + stall detection at 90s + auto-nudge recovery | **In Progress** |
| QDRIFT-02 | Output sanitization gate blocking local-path leakage | **Done** |
| QDRIFT-03 | Correction logging coverage + QA gate enforcement (block Done without correction log) | **In Progress** |
| QDRIFT-04 | PantryPal priority guardrails + synthetic churn cap | **Done** |
| QDRIFT-05 | Synthetic task TTL (60min) + auto-expiry sweep | Pending |
| QDRIFT-06 | Strategic queue reservation (≥30% slots) + priority score writeback | Pending |

All findings sourced from workspace artifacts: `artifacts/qdrift-claude-research-exec-observability.md` and `artifacts/qdrift-claude-research-quality-drift-findings.md`.
