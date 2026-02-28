const test = require('node:test');
const assert = require('node:assert/strict');

const quarantine = require('../scripts/kanban-quarantine-synthetic');

function makeBoard({ backlog = [], todo = [], inProgress = [], done = [] } = {}) {
  return {
    columns: { backlog, todo, inProgress, done },
    activityLog: []
  };
}

test('detectSyntheticCards matches integration dashboard spam cards in todo/inProgress', () => {
  const board = makeBoard({
    todo: [
      {
        id: 's1',
        name: 'Integration dashboard task',
        description: 'should appear in subagents.inProgressTasks',
        source: 'manual'
      },
      {
        id: 'n1',
        name: 'Legit task',
        source: 'manual'
      }
    ],
    inProgress: [
      {
        id: 's2',
        name: 'Integration dashboard task',
        description: 'noise',
        source: 'manual'
      }
    ]
  });

  const found = quarantine.detectSyntheticCards(board);
  assert.equal(found.length, 2);
  assert.deepEqual(
    found.map((x) => x.taskId).sort(),
    ['s1', 's2']
  );
});

test('applyQuarantine removes synthetic cards and creates one rollup card in backlog', () => {
  const board = makeBoard({
    backlog: [{ id: 'keep-backlog', name: 'Normal backlog item', source: 'manual' }],
    todo: [{ id: 's1', name: 'Integration dashboard task', source: 'manual' }],
    inProgress: [
      { id: 's2', name: 'Integration dashboard task', source: 'manual' },
      { id: 'keep-progress', name: 'Real task', source: 'cron' }
    ]
  });

  const detected = quarantine.detectSyntheticCards(board);
  const applied = quarantine.applyQuarantine(board, detected, { nowIso: '2026-02-28T01:23:45.000Z' });

  assert.equal(applied.movedTaskIds.length, 2);
  assert.equal(applied.board.columns.todo.length, 0);
  assert.equal(applied.board.columns.inProgress.length, 1);
  assert.equal(applied.board.columns.inProgress[0].id, 'keep-progress');
  assert.equal(
    applied.board.columns.backlog[0].id,
    'quarantine-synthetic-integration-dashboard-task-rollup'
  );
  assert.equal(applied.board.activityLog[0].type, 'quarantine_rollup_updated');
});

test('parseArgs defaults to report mode when no mode flag provided', () => {
  const args = quarantine.parseArgs(['node', 'scripts/kanban-quarantine-synthetic.js']);
  assert.equal(args.report, true);
  assert.equal(args.apply, false);
});
