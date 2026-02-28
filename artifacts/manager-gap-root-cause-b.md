Research complete. The deliverable is at `artifacts/blocker-management-compliance-patterns.md`.

## Summary of what's covered

**4 core patterns** with implementation pseudocode, prior art tables, and cited sources:

| Pattern | Key Design Decision |
|---------|-------------------|
| **Auto-Spawn Blocker-Handler** | Depth cap=1 prevents recursive explosion; typed action schema forces valid responses; spawn budget caps fleet size |
| **Two-Attempt Repair Policy** | Exactly 2 tries (attempt 2 gets attempt 1's failure context injected); after that, escalate or mark blocked — never retry again |
| **Escalation Gating** | Narrow allowlist: only `permission_denied`, `auth_expired`, `secret_missing`, `sudo_required` (and variants) reach a human; everything else stays internal |
| **Auditable Proof Capture** | Hash-chained, append-only JSON records for every blocker lifecycle event; redaction of secrets; SOX/HIPAA/GDPR retention compliance |

**Also included:**
- 5-phase implementation playbook (classifier → proof system → repair loop → escalation gate → integration)
- 25 acceptance criteria across 5 test suites (AC-1 through AC-5) with named test functions
- YAML configuration reference for all tunables
- ASCII architecture diagram showing the full decision flow
- 20 cited URLs from industry sources (Composio, GitHub Blog, OpenSSF, WorkOS, Tetrate, etc.)
