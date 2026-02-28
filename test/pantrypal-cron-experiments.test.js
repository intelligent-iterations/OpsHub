const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');

const { rankExperiments } = require('../scripts/pantrypal-growth-experiment-prioritizer');

test('pantrypal cron experiments include multiple ready-to-run candidates above launch threshold', () => {
  const filePath = path.resolve(__dirname, '../data/pantrypal-experiments-cron.json');
  const experiments = JSON.parse(fs.readFileSync(filePath, 'utf8'));

  assert.ok(Array.isArray(experiments));
  assert.ok(experiments.length >= 3);

  const ranked = rankExperiments(experiments);
  const launchable = ranked.filter((item) => item.score >= 75);

  assert.ok(launchable.length >= 3);
  assert.ok(launchable.every((item) => /npm test -- test\/pantrypal-/.test(item.validationCommand)));
});
