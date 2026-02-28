const test = require('node:test');
const assert = require('node:assert/strict');

const { computeManagerLoopMetrics, evaluateManagerLoopThresholds } = require('../scripts/manager-loop-guardrails');

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

test('evaluateManagerLoopThresholds enforces MGAP thresholds', () => {
  const fail = evaluateManagerLoopThresholds({ passiveWaitRatio: 0.2, blockerProtocolCompliance: 0.96 });
  assert.equal(fail.pass, false);
  assert.equal(fail.checks.passiveWaitRatio.pass, false);

  const pass = evaluateManagerLoopThresholds({ passiveWaitRatio: 0.1, blockerProtocolCompliance: 1 });
  assert.equal(pass.pass, true);
  assert.equal(pass.checks.blockerProtocolCompliance.pass, true);
});
