# PantryPal Rescue Onboarding v2 Spec

- **Task ID:** `a599d0e6-0d5d-47d2-b37d-909e7b568737`
- **Owner:** Product + Design + Mobile
- **Status:** Ready for implementation slices
- **Last updated:** 2026-02-27

## 1) Problem & Goal

Current onboarding asks for too much setup before users experience a rescue win. Users churn before completing a first rescue.

### Product goal
Design a rescue onboarding v2 that gets users to **first rescue completion in <24h** and creates a **first-week habit loop** with confidence nudges.

### Success target (first 30 days after launch)
- +25% lift in `first_rescue_within_24h_rate`
- +20% lift in `d7_return_rate`
- +15% lift in `rescue_cook_completed / rescue_scan_started`

---

## 2) Benchmark Research Summary (via Claude Code)

Research artifacts generated through Claude Code:
- `artifacts/p25-claude-benchmark-research-v2.md`
- `artifacts/p25-claude-research-notes.md`

### Key takeaways used in this spec
1. **Activation-first beats setup-first:** deliver value before full account/profile friction.
2. **Early confidence loops matter:** first action should feel easy and winnable.
3. **Habit loop requires tiny daily action:** “minimum rescue action” must take ~2 minutes.
4. **Progressive disclosure:** ask only for inputs needed to generate immediate rescue suggestions.
5. **Visible momentum:** celebrate streaks/milestones and show “you’re becoming a rescuer” identity cues.

> Note: benchmark files include directional/proxy ranges and should be treated as hypothesis framing, then calibrated with PantryPal’s own telemetry.

---

## 3) Onboarding v2 Experience (End-to-End)

## 3.1 Journey map (Day 0 to Day 7)

### Day 0 (first session, target ≤ 4 minutes)
1. **Welcome + promise screen**
   - Promise: “Rescue one ingredient tonight in under 10 minutes.”
   - CTA: `Start my first rescue`
2. **2-step setup (progressive disclosure)**
   - Step A: household size (1,2,3-4,5+)
   - Step B: common constraints (none, vegetarian, dairy-free, nut-free, custom)
3. **Quick inventory capture**
   - Primary: scan or type 3 ingredients
   - Fallback chips: “I only have 2 min” / “Surprise me with simple meals”
4. **Instant rescue plan card**
   - 1 “best now” recipe + 2 backup options
   - Confidence cue: “You already have 78% of ingredients.”
5. **Commit moment**
   - CTA: `Cook this now (8 min)`
   - Secondary: `Schedule for tonight`
6. **Completion celebration**
   - “First rescue complete 🎉”
   - Prompt: enable reminder for tomorrow mini-rescue

### Day 1–3 (habit stabilization)
- Daily nudge for a **micro-action**:
  - “Scan 1 ingredient”
  - “Pick tonight’s rescue in 30s”
  - “Finish one 5–10 min rescue”
- Streak framing: “2-day rescue streak” + grace copy (no shame).

### Day 4–7 (identity reinforcement)
- Weekly view: rescued items + estimated waste avoided + money saved.
- Confidence ladder copy: “You’re now a Level 2 Home Rescuer.”
- Branch prompt: invite household member OR keep solo mode.

## 3.2 State model (UI + system)

1. `onboarding_not_started`
2. `onboarding_in_progress`
3. `onboarding_value_delivered` (first plan generated)
4. `onboarding_first_rescue_completed`
5. `habit_week1_active`
6. `habit_week1_lapsed` (miss >48h)
7. `habit_week1_completed`

Transitions are event-driven and mapped to telemetry schema in `data/p25_rescue_friction_telemetry_schema.json`.

---

## 4) Copy Direction

## 4.1 Tone principles
- **Calm confidence** over urgency/shame.
- **Action-oriented** (“Rescue tonight”) not abstract (“Optimize pantry”).
- **Identity reinforcement** (“You’re building a rescue habit”).

## 4.2 Key copy examples by moment
- **Welcome:** “Let’s rescue one ingredient today.”
- **After inventory input:** “Great start — we can make dinner from what you already have.”
- **Plan card confidence nudge:** “High match. Low effort. You can finish in ~8 minutes.”
- **If user hesitates >20s:** “Need something easier? We can switch to 5-minute options.”
- **Post-completion:** “You just prevented food waste today. Nice work.”
- **Lapse recovery (48h):** “No reset needed. Let’s do one tiny rescue now.”

---

## 5) Nudge Framework (Confidence + Habit)

## 5.1 Nudge types
1. **Competence nudges**
   - Trigger: first plan load, successful scan, step completion
   - Message: “You’ve got this — this one’s beginner-friendly.”
2. **Momentum nudges**
   - Trigger: 1+ completed rescues in 3 days
   - Message: “You’re on a streak. Keep it alive with a 2-minute rescue check.”
3. **Recovery nudges**
   - Trigger: inactivity 48h
   - Message: “No pressure — pick one ingredient and we’ll do the rest.”
4. **Proof nudges**
   - Trigger: day 7 summary
   - Message: “This week: 6 items rescued, ~$11 saved.”

## 5.2 Delivery channels
- In-app banners (primary)
- Push notifications (opt-in only)
- Home lock-screen style widget prompt (phase 2)

## 5.3 Frequency caps
- Max 1 push/day
- Max 2 in-app nudges/session
- Suppress non-critical nudges during active cooking flow

---

## 6) Metrics & Experiment Plan

## 6.1 Core metrics
- **Primary:**
  - `first_rescue_within_24h_rate`
  - `end_to_end_rescue_rate`
  - `d7_return_rate`
- **Secondary:**
  - `median_time_to_first_plan`
  - `plan_acceptance_rate`
  - `cook_completion_rate`
  - `week1_streak_2plus_rate`

## 6.2 Experiment design

### Experiment A: Activation-first vs account-first
- **Control:** account creation before plan generation
- **Variant:** plan generation before account wall
- **Hypothesis:** variant improves first plan generated and first rescue completion
- **Guardrails:** crash-free sessions, notification opt-out rate

### Experiment B: Confidence nudge intensity
- **Control:** minimal neutral copy
- **Variant:** confidence cues at plan + step 1 + completion
- **Hypothesis:** variant improves cook start and completion without increasing dismiss rates

### Experiment C: Streak framing
- **Control:** no streak messaging
- **Variant:** soft streak + grace phrasing
- **Hypothesis:** increases D3 and D7 return without anxiety indicators (mute/push disable)

### Analysis window
- 14-day rolling cohorts
- Segment by new vs returning, household size bucket, and prep-time tier

---

## 7) Implementation Slices (Flutter + Firebase)

## Slice 1 — Onboarding shell + state machine
- **Flutter:**
  - Add `OnboardingV2Flow` route with Riverpod/BLoC state machine for the 7 states above.
  - Build modular screens: `Welcome`, `QuickSetup`, `InventoryInput`, `PlanCard`, `Celebrate`.
- **Firebase:**
  - Firestore doc `/users/{uid}/onboardingV2` with fields:
    - `state`, `startedAt`, `completedAt`, `dayIndex`, `lastActiveAt`, `nudgePrefs`

## Slice 2 — Telemetry wiring
- **Flutter:** event emission wrapper (`analytics.trackRescue(event, props)`).
- **Firebase:**
  - GA4 + BigQuery export enabled
  - Event contract aligned to `data/p25_rescue_friction_telemetry_schema.json`
  - Add `journey_id` generated client-side and persisted per onboarding attempt

## Slice 3 — Confidence nudge engine
- **Flutter:** in-app nudge presenter with priority + cooldown rules.
- **Firebase:** Remote Config keys:
  - `onboarding_v2_enabled`
  - `nudge_confidence_level` (`low|med|high`)
  - `streak_grace_hours` (default `48`)

## Slice 4 — Habit loop notifications
- **Flutter:** local scheduling + deep links to “Quick Rescue”.
- **Firebase:** Cloud Functions for push orchestration using inactivity triggers and cap rules.

## Slice 5 — Experiment flags + reporting
- **Flutter:** assignment at first launch (persisted variant key).
- **Firebase:**
  - Remote Config / A/B Testing for experiments A/B/C
  - BigQuery dashboard view for primary KPIs and guardrails

---

## 8) QA Checklist (Screenshot-based Validation)

Capture screenshots for each required state in iOS + Android, light + dark mode where applicable.

## 8.1 Happy path evidence (required)
- [ ] Welcome screen with promise + CTA
- [ ] Quick setup step A + step B completed
- [ ] Inventory entry with 3 ingredients
- [ ] Rescue plan with confidence copy and CTA
- [ ] Cook flow start and at least one step
- [ ] Completion celebration + streak/day badge
- [ ] Day 2 home prompt showing habit nudge

## 8.2 Edge-state evidence (required)
- [ ] No inventory found fallback options
- [ ] Network failure in plan generation with retry
- [ ] User skip path still reaching value moment
- [ ] 48h lapse recovery copy
- [ ] Notification permission denied fallback

## 8.3 Telemetry validation evidence
- [ ] Screenshot/log proving `rescue_scan_started` and `rescue_scan_completed`
- [ ] Screenshot/log proving `rescue_plan_generated` and `rescue_plan_accepted`
- [ ] Screenshot/log proving `rescue_cook_started` and `rescue_cook_completed`
- [ ] `journey_id` consistent across end-to-end run

## 8.4 Accessibility snapshot checks
- [ ] Dynamic text does not clip CTA labels
- [ ] Screen reader focus order on onboarding steps
- [ ] Contrast checks pass for confidence banners

---

## 9) Rollout Plan

1. **Internal dogfood (5%)** for 3 days
2. **Beta cohort (20%)** for 7 days with experiment A live
3. **General rollout (100%)** if guardrails remain stable

Rollback condition: >2% absolute drop in plan acceptance or statistically significant crash increase.

---

## 10) Open Questions

1. Should household invite be in week 1 or delayed to week 2?
2. Should first completion celebration include social share CTA or avoid distraction?
3. Should rescue value show money only, waste only, or both by default?
