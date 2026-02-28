Research complete. Written to `artifacts/manager-mode-drift-deep-research.md`.

## Summary of Findings

The report covers **four root-cause categories** with cited research and concrete fixes:

### 1. Instruction Hierarchy Drift
- Context rot causes >50% performance degradation at 100K tokens even in models with 1M+ windows
- Compaction discards behavioral directives first — "be proactive" instructions are the most fragile
- **Fix**: Periodic goal-reminder injection (measured 30% divergence reduction), adaptive behavioral anchoring with drift-weighted exemplars

### 2. Passive Waiting Loops
- RLHF alignment creates a *structural bias toward passivity* — agents are trained as respondents, not initiators
- Without cron/heartbeat triggers, agents fall back to request-response after every task
- **Fix**: Event-driven wake-up architecture with heartbeat fallback, anti-passivity rules in CLAUDE.md, OpenClaw-style cron-triggered agentic loops

### 3. Weak Task Ownership
- Tasks are treated as suggestions; agents move to `in_progress` but never systematically close with evidence
- Context compaction causes agents to *forget their own in-progress work*
- **Fix**: Claim-Execute-Evidence-Close protocol, automated stale-task sweeps, episodic memory consolidation that survives compaction

### 4. Missing Delegation Triggers
- Without explicit rule-based delegation policies, agents default to doing everything inline
- Tool output bloat fills context, crowding out orchestration logic
- **Fix**: Explicit complexity/context-% delegation triggers, 40% context budget reserved for orchestration, automated subagent spawning rules

### Key KPIs
- **Agent Stability Index** >0.85, **Autonomous Action Rate** >70%, **Passive Wait Ratio** <15%, **Evidence Completion Rate** >95%, **Delegation Rate** >60% for complex tasks, **HITL Deflection** >80%
