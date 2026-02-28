const test = require('node:test');
const assert = require('node:assert/strict');

const cleanup = require('../scripts/inprogress-stale-cleanup');

function makeBoard(tasks) {
  return {
    columns: { backlog: [], todo: [], inProgress: tasks, done: [] },
    activityLog: []
  };
}

test('detectStaleInProgressTasks marks stale when old and unmatched', () => {
  const nowMs = Date.parse('2026-02-28T01:00:00.000Z');
  const board = makeBoard([{ id: 't1', name: 'Integration dashboard task', source: 'manual', createdAt: '2026-02-28T00:00:00.000Z' }]);
  const result = cleanup.detectStaleInProgressTasks(board, { nowMs, staleMinutes: 20, activeSessions: [] });
  assert.equal(result[0].stale, true);
});

test('detectStaleInProgressTasks flags waiting tasks as stalled workers', () => {
  const nowMs = Date.parse('2026-02-28T01:00:00.000Z');
  const board = makeBoard([{ id: 't2', name: 'Worker waiting', description: 'waiting for instruction', createdAt: '2026-02-28T00:55:00.000Z' }]);
  const result = cleanup.detectStaleInProgressTasks(board, { nowMs, staleMinutes: 20, activeSessions: [] });
  assert.equal(result[0].stalledWorker, true);
  assert.equal(result[0].reasons.includes('waiting-or-stalled-signal'), true);
});

test('applyRemediation executes self-recovery and dispatches up to 2 fallback tasks', () => {
  const board = makeBoard([{ id: 't3', name: 'Stalled worker', status: 'inProgress', createdAt: '2026-02-28T00:00:00.000Z' }]);
  const results = [{ taskId: 't3', taskName: 'Stalled worker', stale: true, stalledWorker: true, reasons: ['age-threshold-exceeded'] }];
  const applied = cleanup.applyRemediation(board, results, { staleMinutes: 20, autoRecover: true, fallbackCount: 2 });

  assert.deepEqual(applied.movedTaskIds, ['t3']);
  assert.deepEqual(applied.selfRecoveryAttempts, ['t3']);
  assert.equal(applied.fallbackTaskIds.length, 2);
  assert.equal(applied.board.activityLog.some((e) => e.type === 'worker_self_recovery_attempt'), true);
});

test('applyRemediation caps fallback dispatch at 2 even if higher requested', () => {
  const board = makeBoard([{ id: 't4', name: 'Stalled worker', status: 'inProgress', createdAt: '2026-02-28T00:00:00.000Z' }]);
  const results = [{ taskId: 't4', taskName: 'Stalled worker', stale: false, stalledWorker: true, reasons: ['waiting-or-stalled-signal'] }];
  const applied = cleanup.applyRemediation(board, results, { autoRecover: true, fallbackCount: 5 });
  assert.equal(applied.fallbackTaskIds.length, 2);
});
