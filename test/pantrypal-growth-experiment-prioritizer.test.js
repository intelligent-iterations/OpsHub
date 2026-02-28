const test = require('node:test');
const assert = require('node:assert/strict');

const {
  clamp,
  scoreExperiment,
  rankExperiments,
  formatMarkdown
} = require('../scripts/pantrypal-growth-experiment-prioritizer');

test('clamp keeps values in bounds', () => {
  assert.equal(clamp(-1), 0);
  assert.equal(clamp(2), 1);
  assert.equal(clamp(0.4), 0.4);
});

test('scoreExperiment applies weighted score and rounds', () => {
  const scored = scoreExperiment({
    name: 'test',
    impact: 0.8,
    confidence: 0.6,
    ease: 0.7,
    pantryPalFit: 0.9
  });

  assert.equal(scored.score, 74.5);
});

test('rankExperiments sorts descending by score', () => {
  const ranked = rankExperiments([
    { name: 'B', impact: 0.5, confidence: 0.5, ease: 0.5, pantryPalFit: 0.5 },
    { name: 'A', impact: 0.9, confidence: 0.9, ease: 0.9, pantryPalFit: 0.9 }
  ]);

  assert.equal(ranked[0].name, 'A');
  assert.equal(ranked[1].name, 'B');
});

test('formatMarkdown outputs ranked table', () => {
  const markdown = formatMarkdown([
    { name: 'A', score: 88.5, impact: 0.9, confidence: 0.8, ease: 0.7, pantryPalFit: 1 }
  ]);

  assert.match(markdown, /PantryPal Growth Experiment Priority Queue/);
  assert.match(markdown, /\| 1 \| A \| 88.50 \|/);
});
