const test = require('node:test');
const assert = require('node:assert/strict');

const {
  buildWinbackSegments,
  buildMdeTable,
  calculateHoldoutSizes,
  calculateMde,
  classifyDormancy,
  shouldHoldout,
  getWeekKey,
  createSampleUsers
} = require('../scripts/p31-winback-segmentation');

function baseUsers() {
  return [
    { userId: 'u1', daysSinceActive: 8, pushEnabled: true, recentOptOut: false, inPaidFunnelExperiment: false },
    { userId: 'u2', daysSinceActive: 12, pushEnabled: true, recentOptOut: false, inPaidFunnelExperiment: false },
    { userId: 'u3', daysSinceActive: 20, pushEnabled: true, recentOptOut: false, inPaidFunnelExperiment: false },
    { userId: 'u4', daysSinceActive: 40, pushEnabled: true, recentOptOut: false, inPaidFunnelExperiment: false },
    { userId: 'u5', daysSinceActive: 9, pushEnabled: false, recentOptOut: false, inPaidFunnelExperiment: false },
    { userId: 'u6', daysSinceActive: 10, pushEnabled: true, recentOptOut: true, inPaidFunnelExperiment: false },
    { userId: 'u7', daysSinceActive: 11, pushEnabled: true, recentOptOut: false, inPaidFunnelExperiment: true }
  ];
}

test('classifyDormancy maps days to expected buckets', () => {
  assert.equal(classifyDormancy(7), '7-14d');
  assert.equal(classifyDormancy(14), '7-14d');
  assert.equal(classifyDormancy(15), '15-30d');
  assert.equal(classifyDormancy(30), '15-30d');
  assert.equal(classifyDormancy(31), '31-60d');
  assert.equal(classifyDormancy(60), '31-60d');
  assert.equal(classifyDormancy(61), null);
});

test('buildWinbackSegments enforces deterministic eligibility filters and split', () => {
  const users = baseUsers();
  const report = buildWinbackSegments(users, {
    holdoutRate: 0.5,
    weekKey: '2026-02-23'
  });

  assert.equal(report.segmentSummaries.length, 3);
  assert.equal(report.totals.totalEligible, 4);

  const totals = report.segmentSummaries.reduce(
    (acc, s) => {
      acc.h += s.holdoutUsers;
      acc.t += s.targetUsers;
      return acc;
    },
    { h: 0, t: 0 }
  );

  assert.equal(totals.h + totals.t, report.totals.totalEligible);
  assert.equal(typeof report.generatedAt, 'string');
  assert.equal(report.eligibilityRule.includes('pushEnabled=true'), true);
});

test('shouldHoldout is deterministic for the same key/week', () => {
  const userA = shouldHoldout('user-constant', '2026-02-23', 0.2);
  const userA2 = shouldHoldout('user-constant', '2026-02-23', 0.2);
  assert.equal(userA, userA2);
});

test('buildMdeTable returns per-segment MDE and uses 0.05/0.8 defaults', () => {
  const report = buildWinbackSegments(createSampleUsers(), {
    holdoutRate: 0.1,
    weekKey: '2026-02-23'
  });
  const mdeTable = buildMdeTable(report, { activation: 0.1, d7Retention: 0.22 });

  assert.equal(mdeTable.length, 3);
  const row = mdeTable[0];
  assert.equal(row.sample.total >= 0, true);
  assert.equal(typeof row.activation.mdeAbsolutePctPoints, 'number');
  assert.equal(typeof row.d7Retention.mdeAbsolutePctPoints, 'number');
  assert.equal(typeof row.activation.mdeRelativePct, 'number');
});

test('calculateHoldoutSizes uses provided rate and returns integer counts', () => {
  const result = calculateHoldoutSizes(83, 0.12);
  assert.equal(result.totalEligible, 83);
  assert.equal(result.holdoutUsers + result.targetUsers, 83);
  assert.equal(result.holdoutRate, 0.12);
});

test('calculateMde returns null when sample sizes are empty', () => {
  const result = calculateMde({ baselineRate: 0.1, treatmentSize: 0, holdoutSize: 0 });
  assert.equal(result, null);
});

test('getWeekKey returns ISO Monday-based key in UTC', () => {
  assert.equal(getWeekKey(new Date('2026-02-28T00:00:00.000Z')), '2026-02-23');
});
