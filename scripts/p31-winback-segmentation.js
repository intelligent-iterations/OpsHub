#!/usr/bin/env node

const crypto = require('crypto');

const DORMANCY_WINDOWS = [
  { key: '7-14d', minDays: 7, maxDays: 14 },
  { key: '15-30d', minDays: 15, maxDays: 30 },
  { key: '31-60d', minDays: 31, maxDays: 60 }
];

function clampRate(value, fallback = 0.1) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(0, Math.min(0.5, n));
}

function getWeekKey(referenceDate = new Date()) {
  const date = new Date(referenceDate);
  const day = date.getUTCDay();
  const diffToMonday = (day + 6) % 7;
  date.setUTCDate(date.getUTCDate() - diffToMonday);
  date.setUTCHours(0, 0, 0, 0);
  return date.toISOString().slice(0, 10);
}

function classifyDormancy(daysSinceActive) {
  for (const window of DORMANCY_WINDOWS) {
    if (daysSinceActive >= window.minDays && daysSinceActive <= window.maxDays) {
      return window.key;
    }
  }
  return null;
}

function stablePercentile(seed) {
  const hash = crypto.createHash('sha256').update(seed).digest('hex').slice(0, 12);
  const value = Number.parseInt(hash, 16);
  return value / 0xffffffffffff;
}

function shouldHoldout(userId, weekKey, holdoutRate = 0.1) {
  return stablePercentile(`${weekKey}:${userId}`) < holdoutRate;
}

function calculateHoldoutSizes(totalEligible, holdoutRate = 0.1) {
  const holdoutUsers = Math.round(totalEligible * holdoutRate);
  const targetUsers = Math.max(0, totalEligible - holdoutUsers);
  return { totalEligible, holdoutRate, holdoutUsers, targetUsers };
}

function calculateMde({ baselineRate, treatmentSize, holdoutSize, alpha = 0.05, power = 0.8 }) {
  if (!treatmentSize || !holdoutSize) return null;

  const zAlpha = alpha === 0.05 ? 1.96 : 1.96;
  const zPower = power === 0.8 ? 0.84 : 0.84;
  const z = zAlpha + zPower;
  const p = clampRate(baselineRate, 0.1);

  const se = Math.sqrt(p * (1 - p) * (1 / treatmentSize + 1 / holdoutSize));
  const absoluteLift = z * se;

  return {
    baselineRate: p,
    mdeAbsolute: Number(absoluteLift.toFixed(4)),
    mdeAbsolutePctPoints: Number((absoluteLift * 100).toFixed(2)),
    mdeRelativePct: Number(((absoluteLift / p) * 100).toFixed(2))
  };
}

function buildWinbackSegments(users, options = {}) {
  const weekKey = options.weekKey || getWeekKey(options.referenceDate);
  const holdoutRate = clampRate(options.holdoutRate ?? 0.1, 0.1);

  const filtered = users.filter(
    (u) => u.pushEnabled && !u.recentOptOut && !u.inPaidFunnelExperiment
  );

  const segments = Object.fromEntries(
    DORMANCY_WINDOWS.map((w) => [w.key, { segment: w.key, totalEligible: 0, holdout: [], target: [] }])
  );

  for (const user of filtered) {
    const segment = classifyDormancy(user.daysSinceActive);
    if (!segment) continue;

    segments[segment].totalEligible += 1;
    if (shouldHoldout(user.userId, weekKey, holdoutRate)) {
      segments[segment].holdout.push(user.userId);
    } else {
      segments[segment].target.push(user.userId);
    }
  }

  const segmentSummaries = Object.values(segments).map((segment) => ({
    segment: segment.segment,
    totalEligible: segment.totalEligible,
    holdoutUsers: segment.holdout.length,
    targetUsers: segment.target.length,
    holdoutRateActual: segment.totalEligible
      ? Number((segment.holdout.length / segment.totalEligible).toFixed(4))
      : 0,
    holdoutUserIds: segment.holdout,
    targetUserIds: segment.target
  }));

  const totals = segmentSummaries.reduce(
    (acc, s) => {
      acc.totalEligible += s.totalEligible;
      acc.holdoutUsers += s.holdoutUsers;
      acc.targetUsers += s.targetUsers;
      return acc;
    },
    { totalEligible: 0, holdoutUsers: 0, targetUsers: 0 }
  );

  const expected = calculateHoldoutSizes(totals.totalEligible, holdoutRate);

  return {
    generatedAt: new Date().toISOString(),
    weekKey,
    holdoutRate,
    eligibilityRule: 'pushEnabled=true AND recentOptOut=false AND inPaidFunnelExperiment=false',
    dormancyWindows: DORMANCY_WINDOWS,
    segmentSummaries,
    totals: {
      ...totals,
      holdoutRateActual: totals.totalEligible
        ? Number((totals.holdoutUsers / totals.totalEligible).toFixed(4))
        : 0,
      holdoutSizingExpected: expected
    }
  };
}

function buildMdeTable(segmentationReport, baselines = { activation: 0.1, d7Retention: 0.22 }) {
  return segmentationReport.segmentSummaries.map((segment) => ({
    segment: segment.segment,
    sample: {
      treatment: segment.targetUsers,
      holdout: segment.holdoutUsers,
      total: segment.totalEligible
    },
    activation: calculateMde({
      baselineRate: baselines.activation,
      treatmentSize: segment.targetUsers,
      holdoutSize: segment.holdoutUsers
    }),
    d7Retention: calculateMde({
      baselineRate: baselines.d7Retention,
      treatmentSize: segment.targetUsers,
      holdoutSize: segment.holdoutUsers
    })
  }));
}

function createSampleUsers() {
  const users = [];
  const days = [8, 10, 13, 16, 19, 24, 28, 34, 41, 55, 62, 5];

  for (let i = 1; i <= 120; i += 1) {
    users.push({
      userId: `user-${String(i).padStart(3, '0')}`,
      daysSinceActive: days[(i - 1) % days.length],
      pushEnabled: i % 11 !== 0,
      recentOptOut: i % 13 === 0,
      inPaidFunnelExperiment: i % 17 === 0
    });
  }

  return users;
}

function formatMarkdown(report, mdeTable, baselines) {
  const lines = [];
  lines.push('# P31 Win-Back Dormant Segment Sample');
  lines.push('');
  lines.push(`- Week key: ${report.weekKey}`);
  lines.push(`- Holdout rule: hash(weekKey:userId) < ${report.holdoutRate}`);
  lines.push(`- Eligibility: ${report.eligibilityRule}`);
  lines.push('');
  lines.push('## Segment Counts');
  lines.push('');
  lines.push('| Segment | Eligible | Target | Holdout | Actual Holdout % |');
  lines.push('|---|---:|---:|---:|---:|');
  for (const s of report.segmentSummaries) {
    lines.push(`| ${s.segment} | ${s.totalEligible} | ${s.targetUsers} | ${s.holdoutUsers} | ${(s.holdoutRateActual * 100).toFixed(2)}% |`);
  }
  lines.push(`| Total | ${report.totals.totalEligible} | ${report.totals.targetUsers} | ${report.totals.holdoutUsers} | ${(report.totals.holdoutRateActual * 100).toFixed(2)}% |`);
  lines.push('');
  lines.push('Holdout rationale: stable weekly hash assignment preserves experimental control while preventing churn between target/holdout across reruns in the same ISO week.');
  lines.push('');
  lines.push('## Minimum Detectable Lift (alpha=0.05, power=0.8)');
  lines.push('');
  lines.push(`Baselines: activation=${(baselines.activation * 100).toFixed(1)}%, d7Retention=${(baselines.d7Retention * 100).toFixed(1)}%`);
  lines.push('');
  lines.push('| Segment | Activation MDE (pp) | Activation Rel % | D7 MDE (pp) | D7 Rel % |');
  lines.push('|---|---:|---:|---:|---:|');
  for (const row of mdeTable) {
    lines.push(
      `| ${row.segment} | ${row.activation?.mdeAbsolutePctPoints ?? 'n/a'} | ${row.activation?.mdeRelativePct ?? 'n/a'} | ${row.d7Retention?.mdeAbsolutePctPoints ?? 'n/a'} | ${row.d7Retention?.mdeRelativePct ?? 'n/a'} |`
    );
  }

  return `${lines.join('\n')}\n`;
}

if (require.main === module) {
  const args = process.argv.slice(2);

  const getArg = (name, fallback) => {
    const hasInline = args.find((arg) => arg.startsWith(`--${name}=`));
    if (hasInline) {
      return hasInline.substring(hasInline.indexOf('=') + 1);
    }

    const idx = args.indexOf(`--${name}`);
    if (idx >= 0 && idx + 1 < args.length && !args[idx + 1].startsWith('--')) {
      return args[idx + 1];
    }

    return fallback;
  };

  const holdoutRate = Number(getArg('holdout-rate', '0.1'));
  const weekKey = getArg('week-key', getWeekKey());
  const output = getArg('output', 'json');

  const users = createSampleUsers();
  const report = buildWinbackSegments(users, { holdoutRate, weekKey });
  const baselines = { activation: 0.1, d7Retention: 0.22 };
  const mdeTable = buildMdeTable(report, baselines);

  const payload = {
    ...report,
    mdeBaselines: baselines,
    mdeTable
  };

  if (output === 'md') {
    process.stdout.write(formatMarkdown(report, mdeTable, baselines));
  } else {
    process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
  }
}

module.exports = {
  DORMANCY_WINDOWS,
  getWeekKey,
  classifyDormancy,
  shouldHoldout,
  calculateHoldoutSizes,
  calculateMde,
  buildWinbackSegments,
  buildMdeTable,
  createSampleUsers,
  formatMarkdown
};
