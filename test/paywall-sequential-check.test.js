const test = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync, spawnSync } = require('node:child_process');
const path = require('node:path');

const checker = require('../scripts/paywall-sequential-check');

const scriptPath = path.resolve(__dirname, '..', 'scripts', 'paywall-sequential-check.js');

test('parseArgs parses sequential policy flags', () => {
  const args = checker.parseArgs([
    'node',
    'script.js',
    '--alpha-budget',
    '0.04',
    '--min-look-interval-hours',
    '12',
    '--max-looks-per-week',
    '5',
    '--min-cumulative-visitors',
    '300',
    '--fail-on-issues'
  ]);

  assert.equal(args.alphaBudget, 0.04);
  assert.equal(args.minLookIntervalHours, 12);
  assert.equal(args.maxLooksPerWeek, 5);
  assert.equal(args.minCumulativeVisitors, 300);
  assert.equal(args.failOnIssues, true);
});

test('parseArgs rejects invalid integer policy values', () => {
  assert.throws(
    () => checker.parseArgs(['node', 'script.js', '--min-look-interval-hours', '0']),
    /positive integer/
  );
});

test('validateSequentialSafety passes default sample input', () => {
  const report = checker.validateSequentialSafety(checker.DEFAULT_INPUT, checker.DEFAULT_POLICY);
  assert.equal(report.summary.status, 'pass');
  assert.equal(report.summary.errors, 0);
  assert.equal(report.findings.length, 0);
});

test('validateSequentialSafety flags peeking and alpha overspend', () => {
  const payload = {
    experimentId: 'bad-exp',
    analysisWindow: {
      startedAt: '2026-02-20T00:00:00.000Z',
      endedAt: '2026-02-21T00:00:00.000Z'
    },
    sequentialPlan: {
      method: 'alpha-spending'
    },
    looks: [
      {
        lookNumber: 1,
        lookedAt: '2026-02-20T00:00:00.000Z',
        cumulativeVisitors: 250,
        cumulativeConversions: 30,
        pValue: 0.03,
        alphaSpent: 0.03,
        decision: 'continue'
      },
      {
        lookNumber: 2,
        lookedAt: '2026-02-20T06:00:00.000Z',
        cumulativeVisitors: 300,
        cumulativeConversions: 36,
        pValue: 0.08,
        alphaSpent: 0.06,
        decision: 'stop_winner'
      }
    ]
  };

  const report = checker.validateSequentialSafety(payload, checker.DEFAULT_POLICY);
  const codes = report.findings.map((f) => f.code);

  assert.equal(report.summary.status, 'fail');
  assert.match(codes.join(','), /LOOK_CADENCE_TOO_FREQUENT/);
  assert.match(codes.join(','), /LOOK_INTERVAL_TOO_SHORT/);
  assert.match(codes.join(','), /ALPHA_BUDGET_EXCEEDED/);
  assert.match(codes.join(','), /STOP_WITHOUT_BOUNDARY/);
});

test('validateSequentialSafety flags non-monotonic cumulative series', () => {
  const payload = {
    experimentId: 'monotonic-breach',
    analysisWindow: {
      startedAt: '2026-02-20T00:00:00.000Z',
      endedAt: '2026-02-27T00:00:00.000Z'
    },
    sequentialPlan: {
      method: 'alpha-spending'
    },
    looks: [
      {
        lookNumber: 1,
        lookedAt: '2026-02-21T00:00:00.000Z',
        cumulativeVisitors: 500,
        cumulativeConversions: 60,
        pValue: 0.03,
        alphaSpent: 0.02,
        decision: 'continue'
      },
      {
        lookNumber: 2,
        lookedAt: '2026-02-22T00:00:00.000Z',
        cumulativeVisitors: 480,
        cumulativeConversions: 58,
        pValue: 0.02,
        alphaSpent: 0.01,
        decision: 'continue'
      }
    ]
  };

  const report = checker.validateSequentialSafety(payload, checker.DEFAULT_POLICY);
  const codes = report.findings.map((f) => f.code);

  assert.match(codes.join(','), /CUMULATIVE_VISITORS_DECREASED/);
  assert.match(codes.join(','), /CUMULATIVE_CONVERSIONS_DECREASED/);
  assert.match(codes.join(','), /ALPHA_SPENT_DECREASED/);
});

test('CLI returns non-zero with --fail-on-issues for failing input', () => {
  const badInput = {
    experimentId: 'cli-fail',
    analysisWindow: {
      startedAt: '2026-02-20T00:00:00.000Z',
      endedAt: '2026-02-20T12:00:00.000Z'
    },
    sequentialPlan: { method: 'alpha-spending' },
    looks: [
      {
        lookNumber: 1,
        lookedAt: '2026-02-20T00:00:00.000Z',
        cumulativeVisitors: 250,
        cumulativeConversions: 20,
        pValue: 0.04,
        alphaSpent: 0.03,
        decision: 'continue'
      },
      {
        lookNumber: 2,
        lookedAt: '2026-02-20T03:00:00.000Z',
        cumulativeVisitors: 260,
        cumulativeConversions: 21,
        pValue: 0.045,
        alphaSpent: 0.06,
        decision: 'stop_winner'
      }
    ]
  };

  const inputArg = JSON.stringify(badInput).replace(/"/g, '\\"');
  const result = spawnSync('sh', ['-c', `tmp=$(mktemp); echo "${inputArg}" > "$tmp"; node "${scriptPath}" --input "$tmp" --fail-on-issues; code=$?; rm -f "$tmp"; exit $code`], { encoding: 'utf8' });

  assert.equal(result.status, 1);
});

test('CLI emits JSON summary for deterministic as-of', () => {
  const stdout = execFileSync(process.execPath, [scriptPath, '--as-of', '2026-02-27T00:00:00.000Z'], {
    encoding: 'utf8'
  });

  const parsed = JSON.parse(stdout);
  assert.equal(parsed.generatedAt, '2026-02-27T00:00:00.000Z');
  assert.equal(parsed.summary.status, 'pass');
  assert.equal(parsed.observed.lookCount, 5);
});
