#!/usr/bin/env node

function clamp(value, min = 0, max = 1) {
  if (Number.isNaN(value) || !Number.isFinite(value)) return min;
  return Math.max(min, Math.min(max, value));
}

function scoreExperiment(experiment) {
  const impact = clamp(experiment.impact);
  const confidence = clamp(experiment.confidence);
  const ease = clamp(experiment.ease);
  const pantryPalFit = clamp(experiment.pantryPalFit ?? 1);

  const score = (impact * 0.4 + confidence * 0.25 + ease * 0.2 + pantryPalFit * 0.15) * 100;

  return {
    ...experiment,
    score: Number(score.toFixed(2))
  };
}

function rankExperiments(experiments) {
  return experiments
    .map(scoreExperiment)
    .sort((a, b) => b.score - a.score);
}

function formatMarkdown(ranked) {
  const header = '# PantryPal Growth Experiment Priority Queue\n\n';
  const tableHeader = '| Rank | Experiment | Score | Impact | Confidence | Ease | PantryPal Fit |\n|---:|---|---:|---:|---:|---:|---:|\n';
  const rows = ranked
    .map((exp, index) => `| ${index + 1} | ${exp.name} | ${exp.score.toFixed(2)} | ${clamp(exp.impact).toFixed(2)} | ${clamp(exp.confidence).toFixed(2)} | ${clamp(exp.ease).toFixed(2)} | ${clamp(exp.pantryPalFit ?? 1).toFixed(2)} |`)
    .join('\n');

  return `${header}${tableHeader}${rows}\n`;
}

if (require.main === module) {
  const defaultExperiments = [
    {
      name: 'Expiry-risk push digest with one-tap rescue plan',
      impact: 0.86,
      confidence: 0.72,
      ease: 0.66,
      pantryPalFit: 0.95
    },
    {
      name: 'Post-scan streak nudge after 24h inactivity',
      impact: 0.63,
      confidence: 0.78,
      ease: 0.88,
      pantryPalFit: 0.84
    },
    {
      name: 'Household challenge mode: save $20/week from pantry-first meals',
      impact: 0.8,
      confidence: 0.58,
      ease: 0.51,
      pantryPalFit: 0.9
    }
  ];

  const ranked = rankExperiments(defaultExperiments);
  process.stdout.write(formatMarkdown(ranked));
}

module.exports = {
  clamp,
  scoreExperiment,
  rankExperiments,
  formatMarkdown
};
