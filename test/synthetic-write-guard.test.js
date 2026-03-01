const test = require('node:test');
const assert = require('node:assert/strict');

const { normalizeMode, isDeniedSyntheticPattern, evaluateSyntheticWriteGuard } = require('../lib/synthetic-write-guard');

test('normalizeMode defaults to production and supports diagnostic', () => {
  assert.equal(normalizeMode(undefined), 'production');
  assert.equal(normalizeMode('production'), 'production');
  assert.equal(normalizeMode('diagnostic'), 'diagnostic');
  assert.equal(normalizeMode('DIAGNOSTIC'), 'diagnostic');
});

test('isDeniedSyntheticPattern matches known synthetic placeholders', () => {
  assert.equal(isDeniedSyntheticPattern('Integration dashboard task', 'real details'), true);
  assert.equal(isDeniedSyntheticPattern('Smoke task', ''), true);
  assert.equal(isDeniedSyntheticPattern('placeholder', 'real details'), true);
  assert.equal(isDeniedSyntheticPattern('Legit implementation task', 'Acceptance criteria:\n- real work'), false);
});

test('isDeniedSyntheticPattern avoids false positives for lifecycle/replay phrasing', () => {
  assert.equal(isDeniedSyntheticPattern('Release lifecycle work', 'Evidence: https://github.com/larryclaw/OpsHub/commit/abc123'), false);
  assert.equal(isDeniedSyntheticPattern('Lifecycle replay hardening', 'real details'), false);
});

test('evaluateSyntheticWriteGuard blocks in production and allows in diagnostic', () => {
  const blocked = evaluateSyntheticWriteGuard({
    mode: 'production',
    name: 'Integration dashboard task',
    description: 'placeholder',
    operation: 'unit_test',
    path: 'test/synthetic-write-guard.test.js',
    source: 'unit',
    logger: { warn: () => {} }
  });
  assert.equal(blocked.ok, false);
  assert.equal(blocked.code, 'TASK_ADMISSION_SYNTHETIC_DENIED');

  const allowed = evaluateSyntheticWriteGuard({
    mode: 'diagnostic',
    name: 'Integration dashboard task',
    description: 'placeholder',
    operation: 'unit_test',
    path: 'test/synthetic-write-guard.test.js',
    source: 'unit',
    logger: { warn: () => {} }
  });
  assert.equal(allowed.ok, true);
});
