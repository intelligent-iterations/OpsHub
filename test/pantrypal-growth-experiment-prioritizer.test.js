const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  clamp,
  evaluateReadiness,
  scoreExperiment,
  rankExperiments,
  formatMarkdown,
  loadExperiments
} = require('../scripts/pantrypal-growth-experiment-prioritizer');

test('clamp keeps values in bounds', () => {
  assert.equal(clamp(-1), 0);
  assert.equal(clamp(2), 1);
  assert.equal(clamp(0.4), 0.4);
});

test('evaluateReadiness identifies missing fields', () => {
  const readiness = evaluateReadiness({
    name: 'test',
    acceptanceCriteria: ['one']
  });

  assert.equal(readiness.ready, false);
  assert.deepEqual(readiness.gaps, [
    'missing_hypothesis',
    'missing_primary_metric',
    'insufficient_acceptance_criteria'
  ]);
});

test('scoreExperiment applies weighted score and rounds', () => {
  const scored = scoreExperiment({
    name: 'test',
    impact: 0.8,
    confidence: 0.6,
    ease: 0.7,
    pantryPalFit: 0.9,
    readinessWeight: 1,
    hypothesis: 'x',
    primaryMetric: 'y',
    acceptanceCriteria: ['a', 'b']
  });

  assert.equal(scored.score, 75.5);
  assert.equal(scored.readiness.ready, true);
});

test('rankExperiments prioritizes ready experiments before unready', () => {
  const ranked = rankExperiments([
    {
      name: 'High but unready',
      impact: 1,
      confidence: 1,
      ease: 1,
      pantryPalFit: 1,
      readinessWeight: 1,
      acceptanceCriteria: ['only-one']
    },
    {
      name: 'Ready',
      impact: 0.9,
      confidence: 0.9,
      ease: 0.9,
      pantryPalFit: 0.9,
      readinessWeight: 0.9,
      hypothesis: 'h',
      primaryMetric: 'm',
      acceptanceCriteria: ['c1', 'c2']
    }
  ]);

  assert.equal(ranked[0].name, 'Ready');
  assert.equal(ranked[1].name, 'High but unready');
});

test('rankExperiments falls back to experiment name for deterministic ordering when scores tie', () => {
  const ranked = rankExperiments([
    {
      name: 'zeta rescue flow',
      impact: 0.8,
      confidence: 0.8,
      ease: 0.8,
      pantryPalFit: 0.8,
      readinessWeight: 0.8,
      hypothesis: 'h1',
      primaryMetric: 'm1',
      acceptanceCriteria: ['c1', 'c2']
    },
    {
      name: 'Alpha rescue flow',
      impact: 0.8,
      confidence: 0.8,
      ease: 0.8,
      pantryPalFit: 0.8,
      readinessWeight: 0.8,
      hypothesis: 'h2',
      primaryMetric: 'm2',
      acceptanceCriteria: ['c1', 'c2']
    }
  ]);

  assert.equal(ranked[0].name, 'Alpha rescue flow');
  assert.equal(ranked[1].name, 'zeta rescue flow');
});

test('formatMarkdown outputs readiness columns', () => {
  const markdown = formatMarkdown([
    {
      name: 'A',
      score: 88.5,
      impact: 0.9,
      confidence: 0.8,
      ease: 0.7,
      pantryPalFit: 1,
      readiness: { ready: true, gaps: [] }
    }
  ]);

  assert.match(markdown, /PantryPal Growth Experiment Priority Queue/);
  assert.match(markdown, /\| 1 \| A \| 88.50 \| yes \| — \|/);
});

test('loadExperiments reads JSON arrays', () => {
  const tmpPath = path.join(os.tmpdir(), `pantrypal-exp-${Date.now()}.json`);
  fs.writeFileSync(tmpPath, JSON.stringify([{ name: 'A' }]));

  const experiments = loadExperiments(tmpPath);
  assert.equal(experiments.length, 1);
  assert.equal(experiments[0].name, 'A');

  fs.unlinkSync(tmpPath);
});
