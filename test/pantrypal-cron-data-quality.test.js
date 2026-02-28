const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

function loadCronExperiments() {
  const filePath = path.resolve(__dirname, '../data/pantrypal-experiments-cron.json');
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

test('pantrypal cron experiments enforce launch metadata completeness', () => {
  const experiments = loadCronExperiments();

  assert.ok(Array.isArray(experiments), 'cron experiment payload must be an array');
  assert.ok(experiments.length >= 5, 'cron experiment queue should keep at least 5 candidates');

  for (const experiment of experiments) {
    assert.ok(typeof experiment.name === 'string' && experiment.name.trim().length > 10, 'name is required');
    assert.ok(Number.isFinite(experiment.impact) && experiment.impact >= 0.6 && experiment.impact <= 1, 'impact must be between 0.6 and 1');
    assert.ok(Number.isFinite(experiment.confidence) && experiment.confidence >= 0.6 && experiment.confidence <= 1, 'confidence must be between 0.6 and 1');
    assert.ok(Number.isFinite(experiment.ease) && experiment.ease >= 0.6 && experiment.ease <= 1, 'ease must be between 0.6 and 1');
    assert.ok(Number.isFinite(experiment.pantryPalFit) && experiment.pantryPalFit >= 0.85 && experiment.pantryPalFit <= 1, 'pantryPalFit must be between 0.85 and 1');

    assert.ok(typeof experiment.primaryMetric === 'string' && experiment.primaryMetric.trim().length > 0, 'primaryMetric is required');
    assert.ok(Number.isInteger(experiment.targetLiftPct) && experiment.targetLiftPct >= 5, 'targetLiftPct must be an integer >= 5');
    assert.ok(Number.isInteger(experiment.minimumSampleSize) && experiment.minimumSampleSize >= 1200, 'minimumSampleSize must be an integer >= 1200');
    assert.ok(Number.isInteger(experiment.experimentWindowDays) && experiment.experimentWindowDays >= 7, 'experimentWindowDays must be an integer >= 7');
    assert.ok(typeof experiment.guardrail === 'string' && experiment.guardrail.trim().length > 12, 'guardrail is required');

    assert.match(
      String(experiment.validationCommand || ''),
      /^npm test -- test\/pantrypal-.*\.test\.js$/,
      'validationCommand must target PantryPal automated tests'
    );
  }
});
