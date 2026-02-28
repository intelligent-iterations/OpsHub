const test = require('node:test');
const assert = require('node:assert/strict');

const {
  isPantryPalTask,
  isSyntheticChurnTask,
  prioritizeWithGuardrails,
  computePantryPalWipMetrics
} = require('../scripts/pantrypal-priority-guardrails');

test('prioritizeWithGuardrails keeps PantryPal strategy work ahead of synthetic churn', () => {
  const ranked = prioritizeWithGuardrails([
    { id: 's1', name: 'Smoke lifecycle validation', priority: 'high', source: 'manual' },
    { id: 'p1', name: 'PantryPal rescue plan improvements', priority: 'medium', source: 'automation' }
  ], { syntheticCap: 1 });

  assert.equal(ranked.prioritized[0].id, 'p1');
  assert.equal(ranked.prioritized[1].id, 's1');
});

test('prioritizeWithGuardrails quarantines synthetic overflow beyond cap', () => {
  const ranked = prioritizeWithGuardrails([
    { id: 's1', name: 'Smoke run 1', priority: 'high' },
    { id: 's2', name: 'Smoke run 2', priority: 'high' },
    { id: 's3', name: 'Smoke run 3', priority: 'high' }
  ], { syntheticCap: 1 });

  assert.equal(ranked.prioritized.length, 1);
  assert.equal(ranked.quarantined.length, 2);
});

test('computePantryPalWipMetrics raises drift alert when PantryPal share falls below threshold', () => {
  const metrics = computePantryPalWipMetrics({
    columns: {
      inProgress: [
        { id: '1', name: 'Smoke test lifecycle item' },
        { id: '2', name: 'Integration dashboard task' },
        { id: '3', name: 'Generic QA check' },
        { id: '4', name: 'PantryPal rescue nudge tuning' }
      ]
    }
  }, { threshold: 0.5, minActiveWip: 3 });

  assert.equal(metrics.pantryPalWipCount, 1);
  assert.equal(metrics.activeWipCount, 4);
  assert.equal(metrics.pantryPalWipShare, 0.25);
  assert.equal(metrics.driftAlert, true);
});

test('classification helpers identify PantryPal and synthetic churn signatures', () => {
  assert.equal(isPantryPalTask({ name: 'Pantry waste rescue pack' }), true);
  assert.equal(isSyntheticChurnTask({ name: 'Lifecycle smoke replay' }), true);
});
