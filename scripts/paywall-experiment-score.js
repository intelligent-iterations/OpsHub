#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const DEFAULT_INPUT = {
  experimentId: 'paywall-weekly-001',
  variants: [
    { id: 'control', visitors: 1050, conversions: 89 },
    { id: 'headline-value', visitors: 1030, conversions: 110 },
    { id: 'annual-discount', visitors: 1080, conversions: 97 },
    { id: 'social-proof', visitors: 980, conversions: 83 }
  ]
};

const DEFAULTS = {
  minVisitors: 500,
  confidenceFloor: 0,
  maxConversionRate: 1.0,
  srmThreshold: 0.01
};

function parsePositiveNumber(value, flagName) {
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
    minVisitors: DEFAULTS.minVisitors,
    confidenceFloor: DEFAULTS.confidenceFloor,
    maxConversionRate: DEFAULTS.maxConversionRate,
    srmThreshold: DEFAULTS.srmThreshold
  };

  for (let i = 2; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === '--input') args.input = path.resolve(argv[++i]);
    else if (token === '--output') args.output = path.resolve(argv[++i]);
    else if (token === '--as-of') args.asOf = new Date(argv[++i]).toISOString();
    else if (token === '--min-visitors') args.minVisitors = parsePositiveInteger(argv[++i], '--min-visitors');
    else if (token === '--confidence-floor') args.confidenceFloor = parsePositiveNumber(argv[++i], '--confidence-floor');
    else if (token === '--max-conversion-rate') args.maxConversionRate = parsePositiveNumber(argv[++i], '--max-conversion-rate');
    else if (token === '--srm-threshold') args.srmThreshold = parsePositiveNumber(argv[++i], '--srm-threshold');
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
  console.log(`paywall-experiment-score

Usage:
  node scripts/paywall-experiment-score.js [options]

Options:
  --input <path>              Input JSON with { experimentId, variants[] }
  --output <path>             Output path for scored JSON
  --as-of <iso8601>           Timestamp used in output metadata
  --min-visitors <n>          Eligibility threshold for winner auto-pick (default: ${DEFAULTS.minVisitors})
  --confidence-floor <n>      Minimum Wilson lower bound to declare a winner (default: ${DEFAULTS.confidenceFloor})
  --max-conversion-rate <n>   Flag variants with conversion rate above this as anomalous (default: ${DEFAULTS.maxConversionRate})
  --srm-threshold <p>         p-value threshold for SRM check (default: ${DEFAULTS.srmThreshold})
  -h, --help                  Show help
`);
}

function readInput(inputPath) {
  if (!inputPath) return DEFAULT_INPUT;
  const raw = fs.readFileSync(inputPath, 'utf8');
  return JSON.parse(raw);
}

function wilsonLowerBound(conversions, visitors, z = 1.96) {
  if (visitors <= 0) return 0;
  const p = conversions / visitors;
  const z2 = z * z;
  const denominator = 1 + z2 / visitors;
  const center = p + z2 / (2 * visitors);
  const margin = z * Math.sqrt((p * (1 - p) + z2 / (4 * visitors)) / visitors);
  return Math.max(0, (center - margin) / denominator);
}

/**
 * Chi-squared goodness-of-fit test for sample ratio mismatch.
 * Compares observed visitor counts against expected equal split.
 * Returns { chiSquared, pValue, mismatch }.
 * A p-value below srmThreshold indicates a significant mismatch.
 */
function srmCheck(variants, srmThreshold = DEFAULTS.srmThreshold) {
  const counts = variants.map((v) => Number(v.visitors || 0));
  const total = counts.reduce((sum, c) => sum + c, 0);
  if (total === 0 || counts.length < 2) {
    return { chiSquared: 0, pValue: 1, mismatch: false };
  }

  const expected = total / counts.length;
  const chiSquared = counts.reduce((sum, observed) => {
    const diff = observed - expected;
    return sum + (diff * diff) / expected;
  }, 0);

  // Approximate chi-squared p-value using the regularized gamma function.
  // Degrees of freedom = k - 1.
  const df = counts.length - 1;
  const pValue = 1 - chiSquaredCdf(chiSquared, df);

  return {
    chiSquared: Number(chiSquared.toFixed(4)),
    pValue: Number(pValue.toFixed(6)),
    mismatch: pValue < srmThreshold
  };
}

/**
 * Approximate the chi-squared CDF using the Wilson-Hilferty normal
 * approximation: transforms chi-squared to standard normal.
 * Accurate for df >= 1 across a wide range of x values.
 */
function chiSquaredCdf(x, df) {
  if (x <= 0 || df <= 0) return 0;
  const cube = Math.pow(x / df, 1 / 3);
  const mu = 1 - 2 / (9 * df);
  const sigma = Math.sqrt(2 / (9 * df));
  const z = (cube - mu) / sigma;
  return normalCdf(z);
}

function normalCdf(z) {
  return 0.5 * (1 + erf(z / Math.SQRT2));
}

/**
 * Error function approximation (Abramowitz & Stegun 7.1.26).
 * Max error ~1.5e-7 which is sufficient for SRM detection.
 */
function erf(x) {
  const a1 = 0.254829592;
  const a2 = -0.284496736;
  const a3 = 1.421413741;
  const a4 = -1.453152027;
  const a5 = 1.061405429;
  const p = 0.3275911;
  const sign = x < 0 ? -1 : 1;
  const abs = Math.abs(x);
  const t = 1 / (1 + p * abs);
  const y = 1 - (((((a5 * t + a4) * t) + a3) * t + a2) * t + a1) * t * Math.exp(-abs * abs);
  return sign * y;
}

function scoreVariants(payload, options = {}) {
  const minVisitors = Number.isFinite(options.minVisitors) ? options.minVisitors : DEFAULTS.minVisitors;
  const confidenceFloor = Number.isFinite(options.confidenceFloor) ? options.confidenceFloor : DEFAULTS.confidenceFloor;
  const maxConversionRate = Number.isFinite(options.maxConversionRate) ? options.maxConversionRate : DEFAULTS.maxConversionRate;
  const srmThreshold = Number.isFinite(options.srmThreshold) ? options.srmThreshold : DEFAULTS.srmThreshold;
  const variants = Array.isArray(payload?.variants) ? payload.variants : [];

  // Run SRM check before scoring
  const srm = srmCheck(variants, srmThreshold);

  const scored = variants.map((variant) => {
    const visitors = Number(variant.visitors || 0);
    const conversions = Number(variant.conversions || 0);
    if (!Number.isFinite(visitors) || !Number.isFinite(conversions) || visitors < 0 || conversions < 0 || conversions > visitors) {
      throw new Error(`Invalid variant stats for ${variant.id || 'unknown'}: visitors=${variant.visitors}, conversions=${variant.conversions}`);
    }

    const conversionRate = visitors === 0 ? 0 : conversions / visitors;
    const confidenceScore = wilsonLowerBound(conversions, visitors);
    const eligible = visitors >= minVisitors;
    const anomalous = conversionRate > maxConversionRate;

    return {
      id: String(variant.id),
      visitors,
      conversions,
      conversionRate: Number(conversionRate.toFixed(6)),
      confidenceScore: Number(confidenceScore.toFixed(6)),
      eligible,
      anomalous
    };
  });

  scored.sort((a, b) => {
    if (b.confidenceScore !== a.confidenceScore) return b.confidenceScore - a.confidenceScore;
    if (b.conversionRate !== a.conversionRate) return b.conversionRate - a.conversionRate;
    if (b.visitors !== a.visitors) return b.visitors - a.visitors;
    return a.id.localeCompare(b.id);
  });

  const ranked = scored.map((item, index) => ({ ...item, rank: index + 1 }));

  // Winner must be eligible, not anomalous, not blocked by SRM, and above confidence floor
  const winner = ranked.find(
    (item) => item.eligible && !item.anomalous && !srm.mismatch && item.confidenceScore >= confidenceFloor
  ) || null;

  return {
    experimentId: payload?.experimentId || 'paywall-experiment',
    policy: {
      method: 'wilson-lower-bound',
      confidenceLevel: 0.95,
      minVisitors,
      confidenceFloor,
      maxConversionRate,
      srmThreshold
    },
    guardrails: {
      srm,
      confidenceFloorApplied: confidenceFloor > 0,
      anomalyCheckApplied: maxConversionRate < 1.0
    },
    rankedVariants: ranked,
    winner: winner
      ? {
          id: winner.id,
          rank: winner.rank,
          confidenceScore: winner.confidenceScore,
          conversionRate: winner.conversionRate,
          visitors: winner.visitors,
          conversions: winner.conversions
        }
      : null
  };
}

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(value, null, 2), 'utf8');
}

function runCli(argv) {
  const args = parseArgs(argv);
  const payload = readInput(args.input);
  const scored = scoreVariants(payload, {
    minVisitors: args.minVisitors,
    confidenceFloor: args.confidenceFloor,
    maxConversionRate: args.maxConversionRate,
    srmThreshold: args.srmThreshold
  });
  const output = {
    generatedAt: args.asOf,
    ...scored
  };

  if (args.output) writeJson(args.output, output);
  process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);
  return output;
}

if (require.main === module) {
  try {
    runCli(process.argv);
  } catch (err) {
    console.error(`paywall-experiment-score failed: ${err.message}`);
    process.exit(1);
  }
}

module.exports = {
  DEFAULTS,
  DEFAULT_INPUT,
  parseArgs,
  scoreVariants,
  wilsonLowerBound,
  srmCheck,
  chiSquaredCdf,
  runCli
};
