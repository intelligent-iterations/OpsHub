const test = require('node:test');
const assert = require('node:assert/strict');

const cleanup = require('../scripts/inprogress-stale-cleanup');

function makeBoard(tasks) {
  return {
    columns: {
      backlog: [],
      todo: [],
      inProgress: tasks,
      done: []
    },
    activityLog: []
  };
}

test('detectStaleInProgressTasks marks stale when old and unmatched', () => {
  const nowMs = Date.parse('2026-02-28T01:00:00.000Z');
  const board = makeBoard([
    {
      id: 't1',
      name: 'Integration dashboard task',
      description: 'should appear in subagents.inProgressTasks',
      source: 'manual',
      createdAt: '2026-02-28T00:00:00.000Z'
    }
  ]);

  const result = cleanup.detectStaleInProgressTasks(board, {
    nowMs,
    staleMinutes: 20,
    activeSessions: []
  });

  assert.equal(result.length, 1);
  assert.equal(result[0].stale, true);
  assert.deepEqual(result[0].reasons.sort(), ['age-threshold-exceeded', 'no-active-subagent-match']);
});

test('detectStaleInProgressTasks does not mark stale when active session matches task key', () => {
  const nowMs = Date.parse('2026-02-28T01:00:00.000Z');
  const board = makeBoard([
    {
      id: 't2',
      name: 'Task linked to sub-agent',
      subagentSessionId: 'agent:vibe-coder:subagent:123',
      source: 'heartbeat',
      createdAt: '2026-02-28T00:00:00.000Z'
    }
  ]);

  const result = cleanup.detectStaleInProgressTasks(board, {
    nowMs,
    staleMinutes: 20,
    activeSessions: [{ key: 'agent:vibe-coder:subagent:123' }]
  });

  assert.equal(result.length, 1);
  assert.equal(result[0].stale, false);
  assert.equal(result[0].matchedSessionKeys.length, 1);
});

test('applyRemediation moves stale tasks to todo and writes activity log', () => {
  const board = makeBoard([
    {
      id: 'stale-1',
      name: 'Integration dashboard task',
      source: 'manual',
      createdAt: '2026-02-28T00:00:00.000Z',
      status: 'inProgress'
    },
    {
      id: 'fresh-1',
      name: 'Fresh task',
      source: 'manual',
      createdAt: '2026-02-28T00:59:00.000Z',
      status: 'inProgress'
    }
  ]);

  const staleResults = [
    { taskId: 'stale-1', taskName: 'Integration dashboard task', stale: true },
    { taskId: 'fresh-1', taskName: 'Fresh task', stale: false }
  ];

  const applied = cleanup.applyRemediation(board, staleResults, { staleMinutes: 20 });

  assert.deepEqual(applied.movedTaskIds, ['stale-1']);
  assert.equal(applied.board.columns.inProgress.length, 1);
  assert.equal(applied.board.columns.todo.length, 1);
  assert.equal(applied.board.columns.todo[0].id, 'stale-1');
  assert.equal(applied.board.activityLog[0].type, 'task_reassigned');
});

test('inferLikelyRootCauses identifies generic manual integration dashboard pattern', () => {
  const root = cleanup.inferLikelyRootCauses([
    { stale: true, taskName: 'Integration dashboard task', source: 'manual' },
    { stale: true, taskName: 'Integration dashboard task', source: 'manual' }
  ]);

  assert.equal(root.staleCount, 2);
  assert.equal(root.genericIntegrationTaskCount, 2);
  assert.match(root.likelyCause, /created manually as generic placeholders/i);
});

test('parseArgs accepts repeatable --task-id and de-duplicates values', () => {
  const args = cleanup.parseArgs([
    'node',
    'scripts/inprogress-stale-cleanup.js',
    '--task-id',
    'abc',
    '--task-id',
    'abc',
    '--task-id',
    'def'
  ]);

  assert.deepEqual(args.taskIds, ['abc', 'def']);
});

test('applyRemediation honors scoped stale results for targeted task cleanup', () => {
  const board = makeBoard([
    { id: 'target', name: 'Integration dashboard task', status: 'inProgress' },
    { id: 'other', name: 'Integration dashboard task', status: 'inProgress' }
  ]);

  const staleResults = [
    { taskId: 'target', taskName: 'Integration dashboard task', stale: true },
    { taskId: 'other', taskName: 'Integration dashboard task', stale: false }
  ];

  const applied = cleanup.applyRemediation(board, staleResults, { staleMinutes: 5 });
  assert.deepEqual(applied.movedTaskIds, ['target']);
  assert.equal(applied.board.columns.inProgress.some((t) => t.id === 'other'), true);
});
