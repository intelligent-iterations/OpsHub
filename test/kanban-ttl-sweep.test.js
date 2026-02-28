const test = require('node:test');
const assert = require('node:assert/strict');

const { sweepExpiredTasks, resolveTtlMinutes } = require('../scripts/kanban-ttl-sweep');

test('resolveTtlMinutes defaults synthetic smoke/lifecycle/integration to 60 minutes', () => {
  assert.equal(resolveTtlMinutes({ name: 'Smoke task', source: 'manual' }), 60);
  assert.equal(resolveTtlMinutes({ name: 'Lifecycle task', source: 'manual' }), 60);
  assert.equal(resolveTtlMinutes({ name: 'Integration dashboard task', source: 'manual' }), 60);
  assert.equal(resolveTtlMinutes({ name: 'Strategic task', source: 'intelligent-iteration' }), null);
});

test('kanban TTL sweep expires 61-minute-old synthetic task and keeps strategic tasks', () => {
  const nowMs = Date.parse('2026-02-28T18:00:00.000Z');
  const board = {
    columns: {
      backlog: [],
      todo: [
        {
          id: 'smoke-1',
          name: 'Smoke task',
          source: 'manual',
          status: 'todo',
          createdAt: '2026-02-28T16:59:00.000Z'
        },
        {
          id: 'strategic-1',
          name: 'Strategic growth experiment',
          source: 'intelligent-iteration',
          ttlMinutes: 60,
          status: 'todo',
          createdAt: '2026-02-28T16:00:00.000Z'
        }
      ],
      inProgress: [],
      done: []
    },
    activityLog: []
  };

  const { board: swept, expired } = sweepExpiredTasks(board, { nowMs });

  assert.equal(expired.length, 1);
  assert.equal(expired[0].taskId, 'smoke-1');
  assert.equal(expired[0].reason, 'expired-ttl');

  const doneTask = swept.columns.done.find((task) => task.id === 'smoke-1');
  assert.ok(doneTask);
  assert.equal(doneTask.expiryReason, 'expired-ttl');
  assert.equal(doneTask.ttlMinutes, 60);

  const strategicStillTodo = swept.columns.todo.find((task) => task.id === 'strategic-1');
  assert.ok(strategicStillTodo);
  assert.equal(strategicStillTodo.status, 'todo');

  const expiryLog = swept.activityLog.find((entry) => entry.type === 'task_auto_expired' && entry.taskId === 'smoke-1');
  assert.ok(expiryLog);
  assert.equal(expiryLog.reason, 'expired-ttl');
});
