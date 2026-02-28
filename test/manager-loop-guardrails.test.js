const test = require('node:test');
const assert = require('node:assert/strict');

const {
  computeManagerLoopMetrics,
  evaluateManagerLoopThresholds,
  applyAutoNextActionScheduler,
  applyManagerContractImprovements
} = require('../scripts/manager-loop-guardrails');

function makeBoard(overrides = {}) {
  return {
    columns: {
      backlog: [],
      todo: [],
      inProgress: [],
      done: [],
      ...(overrides.columns || {})
    },
    activityLog: overrides.activityLog || []
  };
}

test('computeManagerLoopMetrics reports passive wait and blocker compliance deterministically', () => {
  const board = makeBoard({
    columns: {
      inProgress: [
        { id: 'a', name: 'Worker waiting', description: 'waiting for instruction', createdAt: '2026-02-28T00:00:00.000Z' },
        { id: 'b', name: 'Active execution', createdAt: '2026-02-28T00:59:00.000Z' }
      ],
      done: [
        {
          id: 'd1',
          status: 'done',
          completionDetails: 'Evidence: https://github.com/larryclaw/OpsHub/commit/1',
          verification: { command: 'npm test', result: 'pass' },
          blocker: { detected: true, repairAttempts: [{ ok: false }, { ok: true }], escalationCategory: 'auth' }
        },
        {
          id: 'd2',
          status: 'done',
          completionDetails: 'Evidence: https://github.com/larryclaw/OpsHub/commit/2',
          verification: { command: 'npm test', result: 'pass' },
          blocker: { detected: true, repairAttempts: [{ ok: false }], escalationCategory: 'network' }
        }
      ]
    },
    activityLog: [
      { type: 'task_added', taskId: 'x' },
      { type: 'task_moved', taskId: 'x', to: 'inProgress' }
    ]
  });

  const metrics = computeManagerLoopMetrics(board, {
    staleMinutes: 20,
    nowMs: Date.parse('2026-02-28T01:00:00.000Z'),
    activeSessions: []
  });

  assert.equal(metrics.passiveWaitRatio, 0.5);
  assert.equal(metrics.delegationRate, 0.5);
  assert.equal(metrics.evidenceCompletionRate, 1);
  assert.equal(metrics.blockerProtocolCompliance, 0.5);
});

test('auto-next-action scheduler dispatches next todo task when passive wait is detected', () => {
  const nowMs = Date.parse('2026-02-28T01:00:00.000Z');
  const board = makeBoard({
    columns: {
      todo: [{ id: 'todo-1', name: 'Queued follow-up', status: 'todo', createdAt: '2026-02-28T00:10:00.000Z' }],
      inProgress: [{ id: 'ip-1', name: 'Worker waiting', status: 'inProgress', createdAt: '2026-02-28T00:00:00.000Z' }]
    }
  });

  const result = applyAutoNextActionScheduler(board, {
    staleMinutes: 20,
    nowMs,
    cooldownMs: 5 * 60 * 1000,
    slaMinutes: 3
  });

  assert.equal(result.changed, true);
  assert.equal(result.reason, 'dispatched');
  assert.equal(result.dispatchedTaskId, 'todo-1');
  assert.equal(result.board.columns.todo.length, 0);
  assert.equal(result.board.columns.inProgress.length, 2);
  assert.equal(result.board.columns.inProgress[0].id, 'todo-1');
  assert.equal(result.board.columns.inProgress[0].status, 'inProgress');
  assert.equal(result.board.activityLog[0].type, 'next_action_scheduled');
  assert.equal(result.board.activityLog[1].type, 'task_moved');
});

test('auto-next-action scheduler respects cooldown and avoids spam dispatch loops', () => {
  const nowMs = Date.parse('2026-02-28T01:00:00.000Z');
  const board = makeBoard({
    columns: {
      todo: [{ id: 'todo-2', name: 'Second queued action', status: 'todo', createdAt: '2026-02-28T00:20:00.000Z' }],
      inProgress: [{ id: 'ip-1', name: 'Worker waiting', status: 'inProgress', createdAt: '2026-02-28T00:00:00.000Z' }]
    },
    activityLog: [{ at: '2026-02-28T00:58:30.000Z', type: 'next_action_scheduled', taskId: 'prior' }]
  });

  const result = applyAutoNextActionScheduler(board, {
    staleMinutes: 20,
    nowMs,
    cooldownMs: 5 * 60 * 1000
  });

  assert.equal(result.changed, false);
  assert.equal(result.reason, 'cooldown_active');
  assert.equal(result.board.columns.todo.length, 1);
  assert.equal(result.board.columns.inProgress.length, 1);
});

test('evaluateManagerLoopThresholds enforces MGAP thresholds', () => {
  const fail = evaluateManagerLoopThresholds({ passiveWaitRatio: 0.2, blockerProtocolCompliance: 0.96 });
  assert.equal(fail.pass, false);
  assert.equal(fail.checks.passiveWaitRatio.pass, false);

  const pass = evaluateManagerLoopThresholds({ passiveWaitRatio: 0.1, blockerProtocolCompliance: 1 });
  assert.equal(pass.pass, true);
  assert.equal(pass.checks.blockerProtocolCompliance.pass, true);
});