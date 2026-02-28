# P29 Win-Back Push Experiment Brief

## Objective
Re-activate users who have gone inactive (no scan in 5–14 days) using behavior-timed push notifications, while protecting notification health and app trust.

## Audience & Scope
- **Population:** users with 5–14 days inactivity, push enabled, not in active paid trial cancellation flow.
- **Exclusions:** users who opted out in last 14 days, hard-bounced devices, users in concurrent win-back tests.
- **Experiment window:** 14 days minimum (extend until each arm has >=5,000 delivered pushes).

## Three Testable Hypotheses
1. **Timing hypothesis (H1):**
   Sending at **18:30 local time** (high-intent window) will produce higher activation than a **10:00 local** send.
   - Test: Control vs timed-treatment at equal copy quality.

2. **Personalization hypothesis (H2):**
   Message copy referencing the user’s **last scanned/viewed category** will increase CTR versus generic reminder copy.
   - Test: Generic vs personalized copy at same send time.

3. **Friction hypothesis (H3):**
   A concise, action-oriented CTA ("Scan in 10 seconds") will improve both activation and D7 retention versus education-heavy body text.
   - Test: Personalized concise CTA vs personalized educational CTA.

## Experiment Arms
- **A (Control):** generic reminder, send 10:00 local.
- **B:** personalized category cue, send 18:30 local.
- **C:** personalized category cue + low-friction CTA, send 18:30 local.

## Success Metrics (with decision thresholds)
1. **Activation lift (primary):** return scan started within 24h of push.
   - Success target: **>= +8% relative lift** for winning variant vs control.

2. **7-day retention (secondary):** user completes >=1 scan in days 2–7 post-exposure.
   - Success target: **>= +3% relative lift** vs control.

3. **Push CTR (secondary):** push_opened / push_delivered.
   - Success target: **>= +10% relative lift** vs control.

> Ship recommendation requires primary metric hit and no guardrail breach. Secondary metrics guide tie-breaks between B and C.

## Guardrails
Monitor daily by variant and overall:
- **Notification opt-out rate** (`notif_optout / push_delivered`) must not rise >20% relative vs control for 2 consecutive days.
- **Uninstall rate** must not rise >10% relative vs control.
- **Negative feedback/report rate** (if available) must not rise >15% relative vs control.
- **Delivery health:** failed delivery rate must remain within normal operational band (+/-5% of weekly baseline).

## Implementation Checklist

### 1) Tracking & Instrumentation
- [ ] Confirm events: `push_sent`, `push_delivered`, `push_opened`, `scan_started`, `scan_completed`, `notif_optout`, `app_uninstall`.
- [ ] Required properties on all win-back events:
  - [ ] `experiment_id` = `p29_winback_push`
  - [ ] `variant` in `{A,B,C}`
  - [ ] `send_hour_local`
  - [ ] `inactive_days_bucket` (5-7, 8-10, 11-14)
  - [ ] `last_scan_category`
- [ ] Validate attribution window logic (24h for activation, 7d for retention).
- [ ] QA event parity across iOS/Android and analytics warehouse ingestion.

### 2) Rollout Plan
- [ ] Build and freeze audience definition in scheduler.
- [ ] Run preflight QA for copy rendering, deep links, and locale fallback.
- [ ] Launch **5% canary** for first 24h with all arms represented.
- [ ] If no guardrail breach, ramp to **25% -> 50% -> 100%** over next 48h.
- [ ] Conduct midpoint review on day 7 (effect size + guardrails + segment cuts).

### 3) Stop Conditions & Response
- [ ] **Immediate experiment pause** if global opt-out guardrail is breached for 2 consecutive days.
- [ ] **Variant-level pause** if any arm breaches uninstall guardrail.
- [ ] **Rollback to control only** if delivery health degrades beyond threshold.
- [ ] Document incident and decision in experiment log within 24h of any pause.

## Readout Requirements
At experiment end, publish a brief readout with:
- Winning variant and confidence/statistical method used.
- Absolute + relative lift for activation, CTR, and D7 retention.
- Guardrail outcomes and recommendation: **Ship / Iterate / Stop**.
