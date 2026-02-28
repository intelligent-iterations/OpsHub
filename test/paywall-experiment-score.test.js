const test = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const path = require('node:path');

const score = require('../scripts/paywall-experiment-score');

// --- Core scoring ---

test('scoreVariants ranks by confidence score and picks eligible winner', () => {
  const result = score.scoreVariants(
    {
      experimentId: 'exp-1',
      variants: [
        { id: 'a', visitors: 1000, conversions: 100 },
        { id: 'b', visitors: 1000, conversions: 120 },
        { id: 'c', visitors: 980, conversions: 78 }
      ]
    },
    { minVisitors: 990 }
  );

  assert.equal(result.rankedVariants[0].id, 'b');
  assert.equal(result.rankedVariants[0].rank, 1);
  assert.equal(result.winner.id, 'b');
  assert.equal(result.rankedVariants.find((v) => v.id === 'c').eligible, false);
});

test('scoreVariants returns null winner when no variant meets threshold', () => {
  const result = score.scoreVariants(
    {
      experimentId: 'exp-2',
      variants: [{ id: 'only', visitors: 200, conversions: 30 }]
    },
    { minVisitors: 500 }
  );

  assert.equal(result.winner, null);
});

test('scoreVariants output includes guardrails and policy fields', () => {
  const result = score.scoreVariants(
    {
      experimentId: 'exp-fields',
      variants: [
        { id: 'a', visitors: 600, conversions: 60 },
        { id: 'b', visitors: 600, conversions: 72 }
      ]
    },
    { minVisitors: 500, confidenceFloor: 0.05, maxConversionRate: 0.5, srmThreshold: 0.01 }
  );

  assert.equal(result.policy.confidenceFloor, 0.05);
  assert.equal(result.policy.maxConversionRate, 0.5);
  assert.equal(result.policy.srmThreshold, 0.01);
  assert.equal(typeof result.guardrails.srm.chiSquared, 'number');
  assert.equal(typeof result.guardrails.srm.pValue, 'number');
  assert.equal(typeof result.guardrails.srm.mismatch, 'boolean');
  assert.equal(result.guardrails.confidenceFloorApplied, true);
  assert.equal(result.guardrails.anomalyCheckApplied, true);
});

// --- Confidence floor ---

test('confidence floor blocks winner below threshold', () => {
  const result = score.scoreVariants(
    {
      experimentId: 'exp-floor',
      variants: [
        { id: 'a', visitors: 1000, conversions: 50 },
        { id: 'b', visitors: 1000, conversions: 55 }
      ]
    },
    { minVisitors: 500, confidenceFloor: 0.10 }
  );

  // Both variants have ~5% conversion, Wilson lower bound well below 0.10
  assert.equal(result.winner, null);
});

test('confidence floor allows winner above threshold', () => {
  const result = score.scoreVariants(
    {
      experimentId: 'exp-floor-pass',
      variants: [
        { id: 'a', visitors: 1000, conversions: 150 },
        { id: 'b', visitors: 1000, conversions: 180 }
      ]
    },
    { minVisitors: 500, confidenceFloor: 0.10 }
  );

  assert.equal(result.winner.id, 'b');
  assert.ok(result.winner.confidenceScore >= 0.10);
});

// --- Anomaly detection ---

test('anomalous variant is flagged and excluded from winner', () => {
  const result = score.scoreVariants(
    {
      experimentId: 'exp-anomaly',
      variants: [
        { id: 'normal', visitors: 1000, conversions: 100 },
        { id: 'suspicious', visitors: 1000, conversions: 600 }
      ]
    },
    { minVisitors: 500, maxConversionRate: 0.50 }
  );

  const suspicious = result.rankedVariants.find((v) => v.id === 'suspicious');
  assert.equal(suspicious.anomalous, true);
  // Winner should be 'normal' since 'suspicious' is flagged
  assert.equal(result.winner.id, 'normal');
});

test('variants within max conversion rate are not flagged', () => {
  const result = score.scoreVariants(
    {
      experimentId: 'exp-clean',
      variants: [
        { id: 'a', visitors: 1000, conversions: 100 },
        { id: 'b', visitors: 1000, conversions: 120 }
      ]
    },
    { minVisitors: 500, maxConversionRate: 0.50 }
  );

  assert.ok(result.rankedVariants.every((v) => !v.anomalous));
});

// --- SRM check ---

test('srmCheck detects balanced traffic (no mismatch)', () => {
  const result = score.srmCheck(
    [{ visitors: 500 }, { visitors: 510 }, { visitors: 490 }],
    0.01
  );

  assert.equal(result.mismatch, false);
  assert.ok(result.pValue > 0.01);
});

test('srmCheck detects severely imbalanced traffic', () => {
  const result = score.srmCheck(
    [{ visitors: 1000 }, { visitors: 1000 }, { visitors: 200 }],
    0.01
  );

  assert.equal(result.mismatch, true);
  assert.ok(result.pValue < 0.01);
});

test('srmCheck blocks winner when mismatch detected', () => {
  const result = score.scoreVariants(
    {
      experimentId: 'exp-srm',
      variants: [
        { id: 'a', visitors: 1000, conversions: 100 },
        { id: 'b', visitors: 1000, conversions: 120 },
        { id: 'c', visitors: 200, conversions: 25 }
      ]
    },
    { minVisitors: 100, srmThreshold: 0.01 }
  );

  assert.equal(result.guardrails.srm.mismatch, true);
  assert.equal(result.winner, null);
});

test('srmCheck handles single variant gracefully', () => {
  const result = score.srmCheck([{ visitors: 1000 }], 0.01);
  assert.equal(result.mismatch, false);
  assert.equal(result.pValue, 1);
});

test('srmCheck handles zero traffic', () => {
  const result = score.srmCheck([{ visitors: 0 }, { visitors: 0 }], 0.01);
  assert.equal(result.mismatch, false);
});

// --- Wilson lower bound ---

test('wilsonLowerBound returns 0 for zero visitors', () => {
  assert.equal(score.wilsonLowerBound(0, 0), 0);
});

test('wilsonLowerBound returns value between 0 and observed rate', () => {
  const lb = score.wilsonLowerBound(100, 1000);
  assert.ok(lb > 0);
  assert.ok(lb < 0.1); // observed rate is 0.1
});

test('wilsonLowerBound increases with more data at same rate', () => {
  const small = score.wilsonLowerBound(10, 100);
  const large = score.wilsonLowerBound(100, 1000);
  // Same rate (10%), more data → tighter bound → higher lower bound
  assert.ok(large > small);
});

// --- Chi-squared CDF ---

test('chiSquaredCdf returns 0 for x <= 0', () => {
  assert.equal(score.chiSquaredCdf(0, 3), 0);
  assert.equal(score.chiSquaredCdf(-1, 3), 0);
});

test('chiSquaredCdf returns ~1 for very large x', () => {
  const cdf = score.chiSquaredCdf(100, 3);
  assert.ok(cdf > 0.999);
});

test('chiSquaredCdf produces reasonable p-value for df=3', () => {
  // chi-squared critical value for p=0.05 at df=3 is ~7.815
  const cdf = score.chiSquaredCdf(7.815, 3);
  assert.ok(Math.abs(cdf - 0.95) < 0.02); // within 2% tolerance
});

// --- Validation ---

test('scoreVariants throws on invalid variant data', () => {
  assert.throws(
    () =>
      score.scoreVariants({
        experimentId: 'bad',
        variants: [{ id: 'x', visitors: 100, conversions: 200 }]
      }),
    /Invalid variant stats/
  );
});

// --- CLI ---

test('CLI emits valid JSON payload with guardrails', () => {
  const scriptPath = path.resolve(__dirname, '..', 'scripts', 'paywall-experiment-score.js');
  const stdout = execFileSync(process.execPath, [scriptPath, '--as-of', '2026-02-27T00:00:00.000Z'], {
    encoding: 'utf8'
  });

  const parsed = JSON.parse(stdout);
  assert.equal(parsed.generatedAt, '2026-02-27T00:00:00.000Z');
  assert.ok(Array.isArray(parsed.rankedVariants));
  assert.equal(typeof parsed.policy.minVisitors, 'number');
  assert.equal(typeof parsed.policy.confidenceFloor, 'number');
  assert.equal(typeof parsed.policy.maxConversionRate, 'number');
  assert.equal(typeof parsed.guardrails.srm.pValue, 'number');
  assert.equal(typeof parsed.guardrails.srm.mismatch, 'boolean');
});

test('CLI respects --confidence-floor flag', () => {
  const scriptPath = path.resolve(__dirname, '..', 'scripts', 'paywall-experiment-score.js');
  const stdout = execFileSync(
    process.execPath,
    [scriptPath, '--as-of', '2026-02-27T00:00:00.000Z', '--confidence-floor', '0.50'],
    { encoding: 'utf8' }
  );

  const parsed = JSON.parse(stdout);
  assert.equal(parsed.policy.confidenceFloor, 0.50);
  // With floor at 0.50, no variant with ~8-10% conversion should win
  assert.equal(parsed.winner, null);
});

test('CLI respects --max-conversion-rate flag', () => {
  const scriptPath = path.resolve(__dirname, '..', 'scripts', 'paywall-experiment-score.js');
  const stdout = execFileSync(
    process.execPath,
    [scriptPath, '--as-of', '2026-02-27T00:00:00.000Z', '--max-conversion-rate', '0.09'],
    { encoding: 'utf8' }
  );

  const parsed = JSON.parse(stdout);
  assert.equal(parsed.policy.maxConversionRate, 0.09);
  // headline-value has ~10.7% conversion → should be anomalous
  const hv = parsed.rankedVariants.find((v) => v.id === 'headline-value');
  assert.equal(hv.anomalous, true);
});

// --- parseArgs ---

test('parseArgs sets defaults when no flags provided', () => {
  const args = score.parseArgs(['node', 'script.js']);
  assert.equal(args.minVisitors, score.DEFAULTS.minVisitors);
  assert.equal(args.confidenceFloor, score.DEFAULTS.confidenceFloor);
  assert.equal(args.maxConversionRate, score.DEFAULTS.maxConversionRate);
  assert.equal(args.srmThreshold, score.DEFAULTS.srmThreshold);
});

test('parseArgs parses all new flags', () => {
  const args = score.parseArgs([
    'node', 'script.js',
    '--confidence-floor', '0.05',
    '--max-conversion-rate', '0.40',
    '--srm-threshold', '0.05'
  ]);
  assert.equal(args.confidenceFloor, 0.05);
  assert.equal(args.maxConversionRate, 0.40);
  assert.equal(args.srmThreshold, 0.05);
});
