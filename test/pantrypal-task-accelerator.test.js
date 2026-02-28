const test = require('node:test');
const assert = require('node:assert/strict');

const {
  toSlug,
  createAcceptanceCriteria,
  buildTaskQueue,
  pickImmediateExecution,
  formatTaskMarkdown
} = require('../scripts/pantrypal-task-accelerator');

test('toSlug normalizes experiment names', () => {
  assert.equal(toSlug('Expiry-risk push digest!'), 'expiry-risk-push-digest');
});

test('createAcceptanceCriteria includes metric and target lift', () => {
  const criteria = createAcceptanceCriteria({
    primaryMetric: 'activation rate',
    targetLiftPct: 10,
    guardrail: 'crash-free sessions remain >=99.5%'
  });

  assert.equal(criteria.length, 4);
  assert.match(criteria[0], /activation rate/);
  assert.match(criteria[1], /10%/);
  assert.match(criteria[2], /99.5%/);
});

test('buildTaskQueue ranks experiments and emits stable ids', () => {
  const queue = buildTaskQueue([
    { name: 'Lower score', impact: 0.4, confidence: 0.5, ease: 0.5, pantryPalFit: 0.5 },
    { name: 'Higher score', impact: 0.9, confidence: 0.9, ease: 0.8, pantryPalFit: 0.9 }
  ], { defaultOwner: 'qa-owner', limit: 1 });

  assert.equal(queue.length, 1);
  assert.equal(queue[0].owner, 'qa-owner');
  assert.match(queue[0].id, /^PP-GROWTH-001-higher-score$/);
});

test('pickImmediateExecution chooses top queue item', () => {
  const plan = pickImmediateExecution([{ id: 'PP-GROWTH-001-foo', title: 'Foo', score: 90, acceptanceCriteria: [] }]);
  assert.equal(plan.taskId, 'PP-GROWTH-001-foo');
  assert.equal(plan.executionNow.length, 3);
});

test('formatTaskMarkdown renders queue and execution section', () => {
  const markdown = formatTaskMarkdown(
    [{ id: 'PP-GROWTH-001-foo', title: 'Foo', score: 91.23, owner: 'growth', acceptanceCriteria: ['a', 'b'] }],
    { taskId: 'PP-GROWTH-001-foo', title: 'Foo', executionNow: ['step1'] }
  );

  assert.match(markdown, /PantryPal Task Queue/);
  assert.match(markdown, /PP-GROWTH-001-foo/);
  assert.match(markdown, /Execute Immediately/);
});
