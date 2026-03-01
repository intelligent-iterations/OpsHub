const test = require('node:test');
const assert = require('node:assert/strict');

const purge = require('../scripts/purge-nonprod-cards');

test('isSyntheticOrTestCard detects synthetic integration cards', () => {
  const yes = purge.isSyntheticOrTestCard({
    name: 'Integration dashboard task',
    source: 'manual',
    description: 'should appear in subagents.inProgressTasks'
  });
  assert.equal(yes, true);
});

test('analyzeBoard counts removable cards per column', () => {
  const report = purge.analyzeBoard({
    columns: {
      todo: [{ id: '1', name: 'Smoke task', description: '', source: 'manual' }],
      inProgress: [{ id: '2', name: 'Real task', description: '', source: 'automation' }],
      done: [{ id: '3', name: 'Integration dashboard task', source: 'manual', description: 'should appear in subagents.inProgressTasks' }]
    }
  });

  assert.equal(report.totalRemoved, 2);
  assert.equal(report.removedByColumn.todo, 1);
  assert.equal(report.removedByColumn.done, 1);
});

test('applyPurge removes flagged cards and logs activity', () => {
  const next = purge.applyPurge({
    columns: {
      todo: [{ id: '1', name: 'Smoke task' }, { id: '2', name: 'Valid item' }],
      inProgress: []
    },
    activityLog: []
  });

  assert.equal(next.columns.todo.length, 1);
  assert.equal(next.columns.todo[0].id, '2');
  assert.equal(next.activityLog[0].type, 'cleanup_nonprod_cards');
});
