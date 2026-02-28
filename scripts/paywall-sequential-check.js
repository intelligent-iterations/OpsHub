#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const DEFAULT_POLICY = {
  alphaBudget: 0.05,
  minLookIntervalHours: 24,
  maxLooksPerWeek: 7,
  minCumulativeVisitors: 200
};

const DEFAULT_INPUT = {
  experimentId: 'paywall-sequential-001',
  analysisWindow: {
    startedAt: '2026-02-20T00:00:00.000Z',
    endedAt: '2026-02-27T00:00:00.000Z'
  },
  sequentialPlan: {
    method: 'alpha-spending',
    alphaBudget: 0.05,
    totalLooksPlanned: 5,
    minLookIntervalHours: 24,
    stoppingBoundary: 'pValue <= cumulativeAlphaSpent'
  },
  looks: [
    { lookNumber: 1, lookedAt: '2026-02-21T00:00:00.000Z', cumulativeVisitors: 280, cumulativeConversions: 28, pValue: 0.047, alphaSpent: 0.01, decision: 'continue' },
    { lookNumber: 2, lookedAt: '2026-02-22T00:00:00.000Z', cumulativeVisitors: 560, cumulativeConversions: 60, pValue: 0.038, alphaSpent: 0.02, decision: 'continue' },
    { lookNumber: 3, lookedAt: '2026-02-23T00:00:00.000Z', cumulativeVisitors: 860, cumulativeConversions: 97, pValue: 0.024, alphaSpent: 0.03, decision: 'continue' },
    { lookNumber: 4, lookedAt: '2026-02-24T00:00:00.000Z', cumulativeVisitors: 1180, cumulativeConversions: 142, pValue: 0.017, alphaSpent: 0.04, decision: 'continue' },
    { lookNumber: 5, lookedAt: '2026-02-25T00:00:00.000Z', cumulativeVisitors: 1500, cumulativeConversions: 192, pValue: 0.011, alphaSpent: 0.05, decision: 'stop_winner' }
  ],
  finalDecision: {
    status: 'winner-declared',
    lookNumber: 5,
    reason: 'Crossed alpha-spending boundary at planned final look.'
  }
};

function parseNonNegativeNumber(value, flagName) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new Error(`${flagName} requires a non-negative number, received: ${value}`);
  }
  return parsed;
}

function parsePositiveInteger(value, flagName) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || Number.isNaN(parsed) || parsed <= 0) {
    throw new Error(`${flagName} requires a positive integer, received: ${value}`);
  }
  return parsed;
}

function parseArgs(argv) {
  const args = {
    input: null,
    output: null,
    asOf: new Date().toISOString(),
    alphaBudget: DEFAULT_POLICY.alphaBudget,
    minLookIntervalHours: DEFAULT_POLICY.minLookIntervalHours,
    maxLooksPerWeek: DEFAULT_POLICY.maxLooksPerWeek,
    minCumulativeVisitors: DEFAULT_POLICY.minCumulativeVisitors,
    failOnIssues: false
  };

  for (let i = 2; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === '--input') args.input = path.resolve(argv[++i]);
    else if (token === '--output') args.output = path.resolve(argv[++i]);
    else if (token === '--as-of') args.asOf = new Date(argv[++i]).toISOString();
    else if (token === '--alpha-budget') args.alphaBudget = parseNonNegativeNumber(argv[++i], '--alpha-budget');
    else if (token === '--min-look-interval-hours') args.minLookIntervalHours = parsePositiveInteger(argv[++i], '--min-look-interval-hours');
    else if (token === '--max-looks-per-week') args.maxLooksPerWeek = parsePositiveInteger(argv[++i], '--max-looks-per-week');
    else if (token === '--min-cumulative-visitors') args.minCumulativeVisitors = parsePositiveInteger(argv[++i], '--min-cumulative-visitors');
    else if (token === '--fail-on-issues') args.failOnIssues = true;
    else if (token === '--help' || token === '-h') {
      printHelp();
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${token}`);
    }
  }

  return args;
}

function printHelp() {
  console.log(`paywall-sequential-check

Usage:
  node scripts/paywall-sequential-check.js [options]

Options:
  --input <path>                    Input JSON with sequential testing metadata
  --output <path>                   Output report path
  --as-of <iso8601>                 Timestamp used in output metadata
  --alpha-budget <n>                Max allowed alpha spending budget (default: ${DEFAULT_POLICY.alphaBudget})
  --min-look-interval-hours <n>     Minimum hours between looks (default: ${DEFAULT_POLICY.minLookIntervalHours})
  --max-looks-per-week <n>          Max looks allowed per 7-day period (default: ${DEFAULT_POLICY.maxLooksPerWeek})
  --min-cumulative-visitors <n>     Minimum cumulative visitors required at each look (default: ${DEFAULT_POLICY.minCumulativeVisitors})
  --fail-on-issues                  Exit non-zero when policy violations are found
  -h, --help                        Show help
`);
}

function readInput(inputPath) {
  if (!inputPath) return DEFAULT_INPUT;
  return JSON.parse(fs.readFileSync(inputPath, 'utf8'));
}

function pushIssue(issues, severity, code, message, remediation, context = null) {
  issues.push({ severity, code, message, remediation, context });
}

function validateSequentialSafety(payload, policy = DEFAULT_POLICY) {
  const issues = [];
  const looks = Array.isArray(payload?.looks) ? payload.looks : [];
  const plan = payload?.sequentialPlan || {};

  if (looks.length === 0) {
    pushIssue(
      issues,
      'error',
      'NO_LOOKS_RECORDED',
      'No sequential looks were provided.',
      'Record each interim look with timestamp, cumulative counts, p-value, and alpha spent.'
    );
    return buildResult(payload, policy, looks, issues);
  }

  if (!plan.method) {
    pushIssue(
      issues,
      'error',
      'MISSING_SEQUENTIAL_PLAN',
      'Sequential plan metadata is missing method information.',
      'Include sequentialPlan.method and associated stopping rules in the analysis payload.'
    );
  }

  const lookTimes = looks.map((look) => new Date(look.lookedAt).getTime());
  const dayCount = Math.max(1, windowDays(payload));
  const looksPerWeek = (looks.length / dayCount) * 7;
  if (looksPerWeek > policy.maxLooksPerWeek) {
    pushIssue(
      issues,
      'error',
      'LOOK_CADENCE_TOO_FREQUENT',
      `Observed ${looksPerWeek.toFixed(2)} looks/week exceeds policy max of ${policy.maxLooksPerWeek}.`,
      'Reduce interim peeks or pre-register a slower look cadence.'
    );
  }

  let previous = null;
  for (const look of looks) {
    const lookNumber = Number(look.lookNumber);
    const visitors = Number(look.cumulativeVisitors);
    const conversions = Number(look.cumulativeConversions);
    const pValue = Number(look.pValue);
    const alphaSpent = Number(look.alphaSpent);
    const lookedAt = new Date(look.lookedAt).getTime();

    if (!Number.isFinite(lookNumber) || lookNumber <= 0) {
      pushIssue(issues, 'error', 'INVALID_LOOK_NUMBER', `Invalid lookNumber: ${look.lookNumber}`, 'Use positive integer lookNumber values.', { look });
    }

    if (!Number.isFinite(lookedAt)) {
      pushIssue(issues, 'error', 'INVALID_LOOK_TIMESTAMP', `Invalid lookedAt timestamp: ${look.lookedAt}`, 'Use ISO-8601 timestamps for lookedAt.', { lookNumber: look.lookNumber });
    }

    if (!Number.isFinite(visitors) || !Number.isFinite(conversions) || visitors < 0 || conversions < 0 || conversions > visitors) {
      pushIssue(
        issues,
        'error',
        'INVALID_CUMULATIVE_COUNTS',
        `Invalid cumulative counts at look ${look.lookNumber}: visitors=${look.cumulativeVisitors}, conversions=${look.cumulativeConversions}`,
        'Ensure cumulativeVisitors/conversions are non-negative numbers and conversions <= visitors.',
        { lookNumber: look.lookNumber }
      );
    }

    if (Number.isFinite(visitors) && visitors < policy.minCumulativeVisitors) {
      pushIssue(
        issues,
        'warn',
        'LOW_SAMPLE_AT_LOOK',
        `Look ${look.lookNumber} has only ${visitors} cumulative visitors (< ${policy.minCumulativeVisitors}).`,
        'Delay interim looks until sufficient sample accrues.'
      );
    }

    if (!Number.isFinite(alphaSpent) || alphaSpent < 0) {
      pushIssue(issues, 'error', 'INVALID_ALPHA_SPENT', `Invalid alphaSpent at look ${look.lookNumber}: ${look.alphaSpent}`, 'Record non-negative alphaSpent at each look.');
    }

    if (Number.isFinite(alphaSpent) && alphaSpent > policy.alphaBudget + 1e-12) {
      pushIssue(
        issues,
        'error',
        'ALPHA_BUDGET_EXCEEDED',
        `Look ${look.lookNumber} alphaSpent=${alphaSpent} exceeds alpha budget ${policy.alphaBudget}.`,
        'Update spending plan or reduce number/frequency of looks.'
      );
    }

    if (Number.isFinite(pValue) && (pValue < 0 || pValue > 1)) {
      pushIssue(issues, 'error', 'INVALID_PVALUE', `Look ${look.lookNumber} has invalid pValue ${look.pValue}.`, 'Ensure pValue is in [0,1].');
    }

    if (previous) {
      if (Number.isFinite(lookNumber) && lookNumber !== previous.lookNumber + 1) {
        pushIssue(
          issues,
          'error',
          'LOOK_SEQUENCE_GAP',
          `Look numbers are not contiguous: got ${lookNumber} after ${previous.lookNumber}.`,
          'Use contiguous ascending look numbers (1,2,3,...).'
        );
      }

      if (Number.isFinite(lookedAt) && Number.isFinite(previous.lookedAt)) {
        const hoursBetween = (lookedAt - previous.lookedAt) / (1000 * 60 * 60);
        if (hoursBetween < policy.minLookIntervalHours) {
          pushIssue(
            issues,
            'error',
            'LOOK_INTERVAL_TOO_SHORT',
            `Look ${look.lookNumber} happened ${hoursBetween.toFixed(2)}h after previous look (< ${policy.minLookIntervalHours}h).`,
            'Avoid repeated peeking; enforce pre-registered minimum interval between looks.'
          );
        }
      }

      if (Number.isFinite(visitors) && Number.isFinite(previous.visitors) && visitors < previous.visitors) {
        pushIssue(
          issues,
          'error',
          'CUMULATIVE_VISITORS_DECREASED',
          `Look ${look.lookNumber} cumulative visitors (${visitors}) is lower than previous look (${previous.visitors}).`,
          'Use cumulative counts; they must be non-decreasing across looks.'
        );
      }

      if (Number.isFinite(conversions) && Number.isFinite(previous.conversions) && conversions < previous.conversions) {
        pushIssue(
          issues,
          'error',
          'CUMULATIVE_CONVERSIONS_DECREASED',
          `Look ${look.lookNumber} cumulative conversions (${conversions}) is lower than previous look (${previous.conversions}).`,
          'Use cumulative conversions; they must be non-decreasing across looks.'
        );
      }

      if (Number.isFinite(alphaSpent) && Number.isFinite(previous.alphaSpent) && alphaSpent < previous.alphaSpent) {
        pushIssue(
          issues,
          'error',
          'ALPHA_SPENT_DECREASED',
          `Look ${look.lookNumber} alphaSpent (${alphaSpent}) is lower than previous look (${previous.alphaSpent}).`,
          'Alpha spending should be cumulative and non-decreasing.'
        );
      }
    }

    if (look.decision === 'stop_winner' && Number.isFinite(pValue) && Number.isFinite(alphaSpent) && pValue > alphaSpent) {
      pushIssue(
        issues,
        'error',
        'STOP_WITHOUT_BOUNDARY',
        `Look ${look.lookNumber} declared stop_winner with pValue ${pValue} > alphaSpent ${alphaSpent}.`,
        'Only stop when pre-registered sequential boundary is crossed.'
      );
    }

    previous = {
      lookNumber,
      lookedAt,
      visitors,
      conversions,
      alphaSpent
    };
  }

  const finalDecision = payload?.finalDecision || null;
  if (finalDecision && Number.isFinite(Number(finalDecision.lookNumber))) {
    const decisionLook = Number(finalDecision.lookNumber);
    if (decisionLook > looks.length) {
      pushIssue(
        issues,
        'error',
        'FINAL_DECISION_LOOK_OUT_OF_RANGE',
        `finalDecision.lookNumber=${decisionLook} exceeds recorded looks (${looks.length}).`,
        'Set finalDecision.lookNumber to an existing look.'
      );
    }
  }

  return buildResult(payload, policy, looks, issues);
}

function windowDays(payload) {
  const start = new Date(payload?.analysisWindow?.startedAt).getTime();
  const end = new Date(payload?.analysisWindow?.endedAt).getTime();
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return 7;
  return (end - start) / (1000 * 60 * 60 * 24);
}

function buildResult(payload, policy, looks, issues) {
  const errorCount = issues.filter((issue) => issue.severity === 'error').length;
  const warningCount = issues.filter((issue) => issue.severity === 'warn').length;

  return {
    experimentId: payload?.experimentId || 'paywall-sequential-experiment',
    policy,
    observed: {
      lookCount: looks.length,
      analysisWindowDays: Number(windowDays(payload).toFixed(2))
    },
    summary: {
      status: errorCount === 0 ? 'pass' : 'fail',
      errors: errorCount,
      warnings: warningCount
    },
    findings: issues
  };
}

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(value, null, 2), 'utf8');
}

function runCli(argv) {
  const args = parseArgs(argv);
  const input = readInput(args.input);
  const policy = {
    alphaBudget: args.alphaBudget,
    minLookIntervalHours: args.minLookIntervalHours,
    maxLooksPerWeek: args.maxLooksPerWeek,
    minCumulativeVisitors: args.minCumulativeVisitors
  };

  const report = {
    generatedAt: args.asOf,
    ...validateSequentialSafety(input, policy)
  };

  if (args.output) writeJson(args.output, report);
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);

  if (args.failOnIssues && report.summary.status === 'fail') {
    process.exitCode = 1;
  }

  return report;
}

if (require.main === module) {
  try {
    runCli(process.argv);
  } catch (err) {
    console.error(`paywall-sequential-check failed: ${err.message}`);
    process.exit(1);
  }
}

module.exports = {
  DEFAULT_POLICY,
  DEFAULT_INPUT,
  parseArgs,
  validateSequentialSafety,
  runCli
};
