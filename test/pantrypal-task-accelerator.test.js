const test = require('node:test');
const assert = require('node:assert/strict');

const {
  toSlug,
  createAcceptanceCriteria,
  buildTaskQueue,
  isQueueLight,
  createLightQueueSeedTasks,
  pickImmediateExecution,
  runValidationCommand,
  formatTaskMarkdown
} = require('../scripts/pantrypal-task-accelerator');

test('toSlug normalizes experiment names', () => {
  assert.equal(toSlug('Expiry-risk push digest!'), 'expiry-risk-push-digest');
});

test('createAcceptanceCriteria includes metric, target lift, sample gate, and validation command', () => {
  const criteria = createAcceptanceCriteria({
    primaryMetric: 'activation rate',
    targetLiftPct: 10,
    minimumSampleSize: 2000,
    experimentWindowDays: 21,
    guardrail: 'crash-free sessions remain >=99.5%',
    validationCommand: 'npm test -- growth'
  });

  assert.equal(criteria.length, 6);
  assert.match(criteria[0], /activation rate/);
  assert.match(criteria[1], /10%/);
  assert.match(criteria[2], /2000 qualified households/);
  assert.match(criteria[2], /21 days/);
  assert.match(criteria[3], /99.5%/);
  assert.match(criteria[4], /npm test -- growth/);
});

test('buildTaskQueue ranks experiments and emits stable ids', () => {
  const queue = buildTaskQueue([
    { name: 'Lower score', impact: 0.4, confidence: 0.5, ease: 0.5, pantryPalFit: 0.5 },
    { name: 'Higher score', impact: 0.9, confidence: 0.9, ease: 0.8, pantryPalFit: 0.9 }
  ], { defaultOwner: 'qa-owner', limit: 1 });

  assert.equal(queue.length, 1);
  assert.equal(queue[0].owner, 'qa-owner');
  assert.match(queue[0].id, /^PP-GROWTH-001-higher-score$/);
  assert.equal(queue[0].validationCommand, 'npm test');
});

test('isQueueLight applies default threshold', () => {
  assert.equal(isQueueLight([{ id: 'one' }, { id: 'two' }]), true);
  assert.equal(isQueueLight([{ id: 'one' }, { id: 'two' }, { id: 'three' }]), false);
});

test('createLightQueueSeedTasks returns pantrypal-ready tasks with acceptance inputs', () => {
  const seeds = createLightQueueSeedTasks({ validationCommand: 'npm test -- pantrypal' });
  assert.equal(seeds.length, 2);
  assert.match(seeds[0].name, /lapsed households/i);
  assert.equal(seeds[0].minimumSampleSize, 1600);
  assert.equal(seeds[0].experimentWindowDays, 14);
  assert.equal(seeds[0].validationCommand, 'npm test -- pantrypal');
});

test('pickImmediateExecution chooses top queue item and includes validation step', () => {
  const plan = pickImmediateExecution([{ id: 'PP-GROWTH-001-foo', title: 'Foo', score: 90, acceptanceCriteria: [], validationCommand: 'npm test -- foo' }]);
  assert.equal(plan.taskId, 'PP-GROWTH-001-foo');
  assert.equal(plan.executionNow.length, 4);
  assert.equal(plan.validationCommand, 'npm test -- foo');
  assert.match(plan.executionNow[2], /npm test -- foo/);
});

test('runValidationCommand returns PASS with output snippet', () => {
  const result = runValidationCommand('npm test -- smoke', {
    runner: () => 'line1\nline2\nline3'
  });

  assert.equal(result.status, 'PASS');
  assert.equal(result.exitCode, 0);
  assert.equal(result.command, 'npm test -- smoke');
  assert.match(result.outputSnippet, /line3/);
});

test('runValidationCommand returns FAIL when runner throws', () => {
  const error = new Error('boom');
  error.status = 2;
  error.stdout = 'stdout-line';
  error.stderr = 'stderr-line';

  const result = runValidationCommand('npm test -- fail', {
    runner: () => {
      throw error;
    }
  });

  assert.equal(result.status, 'FAIL');
  assert.equal(result.exitCode, 2);
  assert.match(result.outputSnippet, /stderr-line/);
});

test('formatTaskMarkdown renders queue execution and validation section', () => {
  const markdown = formatTaskMarkdown(
    [{ id: 'PP-GROWTH-001-foo', title: 'Foo', score: 91.23, owner: 'growth', acceptanceCriteria: ['a', 'b'] }],
    { taskId: 'PP-GROWTH-001-foo', title: 'Foo', executionNow: ['step1'] },
    { status: 'PASS', command: 'npm test', exitCode: 0, durationMs: 1234, outputSnippet: 'ok' }
  );

  assert.match(markdown, /PantryPal Task Queue/);
  assert.match(markdown, /PP-GROWTH-001-foo/);
  assert.match(markdown, /Execute Immediately/);
  assert.match(markdown, /Validation Result/);
  assert.match(markdown, /Status: PASS/);
});