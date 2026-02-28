#!/usr/bin/env node

const fs = require('node:fs');

function clamp(value, min = 0, max = 1) {
  if (Number.isNaN(value) || !Number.isFinite(value)) return min;
  return Math.max(min, Math.min(max, value));
}

function evaluateReadiness(experiment) {
  const gaps = [];

  if (!experiment.hypothesis || typeof experiment.hypothesis !== 'string') {
    gaps.push('missing_hypothesis');
  }

  if (!experiment.primaryMetric || typeof experiment.primaryMetric !== 'string') {
    gaps.push('missing_primary_metric');
  }

  if (!Array.isArray(experiment.acceptanceCriteria) || experiment.acceptanceCriteria.length < 2) {
    gaps.push('insufficient_acceptance_criteria');
  }

  return {
    ready: gaps.length === 0,
    gaps
  };
}

function scoreExperiment(experiment) {
  const impact = clamp(experiment.impact);
  const confidence = clamp(experiment.confidence);
  const ease = clamp(experiment.ease);
  const pantryPalFit = clamp(experiment.pantryPalFit ?? 1);
  const readinessWeight = clamp(experiment.readinessWeight ?? 1);

  const score = (impact * 0.35 + confidence * 0.25 + ease * 0.2 + pantryPalFit * 0.15 + readinessWeight * 0.05) * 100;
  const readiness = evaluateReadiness(experiment);

  return {
    ...experiment,
    readiness,
    score: Number(score.toFixed(2))
  };
}

function rankExperiments(experiments) {
  return experiments
    .map(scoreExperiment)
    .sort((a, b) => {
      if (a.readiness.ready !== b.readiness.ready) {
        return a.readiness.ready ? -1 : 1;
      }

      if (a.score !== b.score) {
        return b.score - a.score;
      }

      const aFit = clamp(a.pantryPalFit ?? 1);
      const bFit = clamp(b.pantryPalFit ?? 1);
      if (aFit !== bFit) {
        return bFit - aFit;
      }

      return String(a.name ?? '').localeCompare(String(b.name ?? ''), undefined, { sensitivity: 'base' });
    });
}

function formatMarkdown(ranked) {
  const header = '# PantryPal Growth Experiment Priority Queue\n\n';
  const tableHeader = '| Rank | Experiment | Score | Ready | Readiness Gaps | Impact | Confidence | Ease | PantryPal Fit |\n|---:|---|---:|---:|---|---:|---:|---:|---:|\n';
  const rows = ranked
    .map((exp, index) => {
      const readinessGaps = exp.readiness.gaps.length ? exp.readiness.gaps.join(', ') : '—';
      const readiness = exp.readiness.ready ? 'yes' : 'no';
      return `| ${index + 1} | ${exp.name} | ${exp.score.toFixed(2)} | ${readiness} | ${readinessGaps} | ${clamp(exp.impact).toFixed(2)} | ${clamp(exp.confidence).toFixed(2)} | ${clamp(exp.ease).toFixed(2)} | ${clamp(exp.pantryPalFit ?? 1).toFixed(2)} |`;
    })
    .join('\n');

  return `${header}${tableHeader}${rows}\n`;
}

function loadExperiments(inputPath) {
  if (!inputPath) {
    return null;
  }

  const raw = fs.readFileSync(inputPath, 'utf8');
  const parsed = JSON.parse(raw);

  if (!Array.isArray(parsed)) {
    throw new Error('Input JSON must be an array of experiments');
  }

  return parsed;
}

if (require.main === module) {
  const inputArgIndex = process.argv.indexOf('--input');
  const inputPath = inputArgIndex > -1 ? process.argv[inputArgIndex + 1] : undefined;
  const fromFile = loadExperiments(inputPath);

  const defaultExperiments = [
    {
      name: 'Expiry-risk push digest with one-tap rescue plan',
      impact: 0.86,
      confidence: 0.72,
      ease: 0.66,
      pantryPalFit: 0.95,
      readinessWeight: 0.95,
      hypothesis: 'A daily digest will reduce item spoilage by prompting rescue actions before expiry.',
      primaryMetric: 'weekly_spoilage_events_per_active_household',
      acceptanceCriteria: ['10% reduction in spoilage events', 'Digest open rate >= 35%']
    },
    {
      name: 'Post-scan streak nudge after 24h inactivity',
      impact: 0.63,
      confidence: 0.78,
      ease: 0.88,
      pantryPalFit: 0.84,
      readinessWeight: 0.8,
      hypothesis: 'Timed nudges after inactivity improve scan consistency and retention.',
      primaryMetric: '7d_scan_retention',
      acceptanceCriteria: ['+8% in 7-day scan retention', 'Push opt-out rate <= 2%']
    },
    {
      name: 'Household challenge mode: save $20/week from pantry-first meals',
      impact: 0.8,
      confidence: 0.58,
      ease: 0.51,
      pantryPalFit: 0.9,
      readinessWeight: 0.45,
      acceptanceCriteria: ['Challenge enrollment >= 20%']
    }
  ];

  const ranked = rankExperiments(fromFile ?? defaultExperiments);
  process.stdout.write(formatMarkdown(ranked));
}

module.exports = {
  clamp,
  evaluateReadiness,
  scoreExperiment,
  rankExperiments,
  formatMarkdown,
  loadExperiments
};
