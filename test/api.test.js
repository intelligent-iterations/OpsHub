const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('os');
const fs = require('fs/promises');
const path = require('path');

const { startServer } = require('../server');

function inProgressFields() {
  const now = new Date().toISOString();
  return { claimedBy: 'test-agent', startedAt: now, updatedAt: now };
}

async function makeServer(options = {}) {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'opshub-test-'));
  process.env.OPSHUB_DATA_DIR = tempDir;
  if (options.telemetryFixture) {
    process.env.OPSHUB_TELEMETRY_FIXTURE = options.telemetryFixture;
  } else {
    delete process.env.OPSHUB_TELEMETRY_FIXTURE;
  }

  const server = startServer(0);
  await new Promise((resolve) => server.once('listening', resolve));

  const { port } = server.address();
  const baseUrl = `http://127.0.0.1:${port}`;

  return {
    baseUrl,
    close: async () => {
      await new Promise((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
      await fs.rm(tempDir, { recursive: true, force: true });
      delete process.env.OPSHUB_TELEMETRY_FIXTURE;
      delete process.env.OPSHUB_DATA_DIR;
      delete process.env.OPSHUB_BOARD_MODE;
    }
  };
}

test('health endpoint returns ok', { concurrency: false }, async () => {
  const app = await makeServer();
  try {
    const res = await fetch(`${app.baseUrl}/api/health`);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.status, 'ok');
    assert.ok(typeof body.uptimeSeconds === 'number');
  } finally {
    await app.close();
  }
});

test('kanban create + move flow works and validates bad input', { concurrency: false }, async () => {
  const app = await makeServer();
  try {
    const badCreate = await fetch(`${app.baseUrl}/api/kanban/task`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: '   ' })
    });
    assert.equal(badCreate.status, 400);

    const create = await fetch(`${app.baseUrl}/api/kanban/task`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Delivery task', description: 'verify kanban', priority: 'high' })
    });
    assert.equal(create.status, 200);
    const createBody = await create.json();
    assert.equal(createBody.ok, true);
    assert.equal(createBody.task.priority, 'high');
    const taskId = createBody.task.id;

    const badMove = await fetch(`${app.baseUrl}/api/kanban/move`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ taskId, to: 'invalid' })
    });
    assert.equal(badMove.status, 400);

    const move = await fetch(`${app.baseUrl}/api/kanban/move`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        taskId,
        to: 'done',
        summary: 'finished',
        completionDetails: 'Evidence: https://github.com/larryclaw/OpsHub/commit/abc123',
        verification: { command: 'npm test', result: 'pass', verifiedAt: new Date().toISOString() }
      })
    });
    assert.equal(move.status, 200);
    const moveBody = await move.json();
    assert.equal(moveBody.task.status, 'done');
    assert.ok(moveBody.task.completedAt);
  } finally {
    await app.close();
  }
});

test('task admission validator blocks synthetic placeholder titles in production mode', { concurrency: false }, async () => {
  const app = await makeServer();
  const warnEvents = [];
  const originalWarn = console.warn;
  console.warn = (...args) => warnEvents.push(args[0]);
  try {
    const syntheticPayloads = [
      { name: 'Integration dashboard task', description: 'real work item details' },
      { name: 'Smoke task', description: 'manager-gap simulation placeholder card' },
      { name: 'Lifecycle task', description: 'synthetic lifecycle replay' },
      { name: 'Closeout reminder', description: 'manager-gap simulation follow-up' }
    ];

    for (const payload of syntheticPayloads) {
      const create = await fetch(`${app.baseUrl}/api/kanban/task`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...payload, status: 'todo' })
      });

      assert.equal(create.status, 422, `expected synthetic denial for ${payload.name}`);
      const body = await create.json();
      assert.equal(body.code, 'TASK_ADMISSION_SYNTHETIC_DENIED');
    }

    assert.equal(warnEvents.some((event) => event?.event === 'synthetic_write_guard_blocked' && event?.path === '/api/kanban/task'), true);
  } finally {
    console.warn = originalWarn;
    await app.close();
  }
});

test('cleanup endpoint removes existing synthetic/test kanban tasks via API', { concurrency: false }, async () => {
  const app = await makeServer();
  try {
    const seedPayloads = [
      { name: 'Integration dashboard task', description: 'synthetic seed', source: 'manual' },
      { name: 'Real product task', description: 'Acceptance criteria:\n- keep this card', source: 'manual' },
      { name: 'Temporary QA fixture', description: 'investigation task', source: 'test-harness' }
    ];

    for (const payload of seedPayloads) {
      const create = await fetch(`${app.baseUrl}/api/kanban/task`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...payload, status: 'todo' })
      });
      if (payload.name === 'Integration dashboard task') {
        assert.equal(create.status, 422);
      } else {
        assert.equal(create.status, 200);
      }
    }

    const syntheticBypass = await fetch(`${app.baseUrl}/api/kanban/task`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Manual regression task',
        description: 'real details',
        source: 'synthetic-runner',
        status: 'todo'
      })
    });
    assert.equal(syntheticBypass.status, 200);

    const cleanup = await fetch(`${app.baseUrl}/api/kanban/cleanup-synthetic`, { method: 'POST' });
    assert.equal(cleanup.status, 200);
    const body = await cleanup.json();
    assert.equal(body.ok, true);
    assert.equal(body.removedCount, 2);
    assert.equal(body.board.columns.todo.some((task) => task.name === 'Manual regression task'), false);
    assert.equal(body.board.columns.todo.some((task) => task.name === 'Real product task'), true);
  } finally {
    await app.close();
  }
});

test('task admission validator blocks duplicate active cards', { concurrency: false }, async () => {
  const app = await makeServer();
  try {
    const payload = {
      name: 'Implement telemetry collector',
      description: 'Wire active sessions and runs into dashboard payload',
      status: 'todo'
    };

    const first = await fetch(`${app.baseUrl}/api/kanban/task`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    assert.equal(first.status, 200);

    const second = await fetch(`${app.baseUrl}/api/kanban/task`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    assert.equal(second.status, 409);
    const body = await second.json();
    assert.equal(body.code, 'TASK_ADMISSION_DUPLICATE_ACTIVE');
  } finally {
    await app.close();
  }
});

test('WIP cap blocks non-critical intake into inProgress', { concurrency: false }, async () => {
  const app = await makeServer();
  try {
    for (let idx = 0; idx < 5; idx++) {
      const create = await fetch(`${app.baseUrl}/api/kanban/task`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: `Active delivery ${idx + 1}`,
          description: `Delivery task ${idx + 1}`,
          status: 'inProgress',
          ...inProgressFields()
        })
      });
      assert.equal(create.status, 200);
    }

    const capped = await fetch(`${app.baseUrl}/api/kanban/task`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Active delivery overflow',
        description: 'Should be blocked by WIP cap',
        status: 'inProgress',
        priority: 'high',
        ...inProgressFields()
      })
    });

    assert.equal(capped.status, 422);
    const body = await capped.json();
    assert.equal(body.code, 'WIP_LIMIT_EXCEEDED');
  } finally {
    await app.close();
  }
});

test('kanban lifecycle preserves completedAt semantics when reopened', { concurrency: false }, async () => {
  const app = await makeServer();
  try {
    const create = await fetch(`${app.baseUrl}/api/kanban/task`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Release lifecycle work',
        status: 'done',
        verification: { command: 'npm run qa:evidence-check', result: 'pass', verifiedAt: new Date().toISOString() },
        description: 'Evidence: https://github.com/larryclaw/OpsHub/commit/abc123'
      })
    });
    assert.equal(create.status, 200);
    const created = await create.json();
    assert.equal(created.task.status, 'done');
    assert.ok(created.task.completedAt);
    const taskId = created.task.id;

    const reopen = await fetch(`${app.baseUrl}/api/kanban/move`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ taskId, to: 'todo', summary: 'needs follow-up' })
    });
    assert.equal(reopen.status, 200);
    const reopened = await reopen.json();
    assert.equal(reopened.task.status, 'todo');
    assert.equal(reopened.task.completedAt, null);

    const reclose = await fetch(`${app.baseUrl}/api/kanban/move`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        taskId,
        to: 'done',
        summary: 'finally done',
        verification: { command: 'npm test', result: 'pass', verifiedAt: new Date().toISOString() },
        completionDetails: 'Evidence: https://github.com/larryclaw/OpsHub/commit/abc123'
      })
    });
    assert.equal(reclose.status, 200);
    const reclosed = await reclose.json();
    assert.equal(reclosed.task.status, 'done');
    assert.ok(reclosed.task.completedAt);
  } finally {
    await app.close();
  }
});

test('done task creation is rejected when description leaks local path evidence', async () => {
  const app = await makeServer();
  try {
    const create = await fetch(`${app.baseUrl}/api/kanban/task`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Bad done evidence',
        status: 'done',
        description: 'Evidence: /Users/claw/.openclaw/workspace/OpsHub/artifacts/report.md'
      })
    });

    assert.equal(create.status, 400);
    const body = await create.json();
    assert.match(body.error, /human-facing output policy gate/);
  } finally {
    await app.close();
  }
});

test('done transition requires GitHub evidence in completion details', async () => {
  const app = await makeServer();
  try {
    const create = await fetch(`${app.baseUrl}/api/kanban/task`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Move target', status: 'todo', description: 'move target description' })
    });
    const created = await create.json();

    const badMove = await fetch(`${app.baseUrl}/api/kanban/move`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        taskId: created.task.id,
        to: 'done',
        completionDetails: 'Evidence: artifacts/local.md',
        verification: { command: 'npm test', result: 'pass', verifiedAt: new Date().toISOString() }
      })
    });
    assert.equal(badMove.status, 400);

    const badVerificationMove = await fetch(`${app.baseUrl}/api/kanban/move`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        taskId: created.task.id,
        to: 'done',
        completionDetails: 'Evidence: https://github.com/larryclaw/OpsHub/commit/abc123',
        verification: { command: 'npm test', result: 'fail', verifiedAt: new Date().toISOString() }
      })
    });
    assert.equal(badVerificationMove.status, 422);

    const goodMove = await fetch(`${app.baseUrl}/api/kanban/move`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        taskId: created.task.id,
        to: 'done',
        completionDetails: 'Evidence: https://github.com/larryclaw/OpsHub/commit/abc123',
        verification: { command: 'npm run qa:evidence-check', result: 'pass', verifiedAt: new Date().toISOString() }
      })
    });
    assert.equal(goodMove.status, 200);
    const done = await goodMove.json();
    assert.match(done.task.completionDetails, /https:\/\/github\.com/);
  } finally {
    await app.close();
  }
});

test('done transition enforces correction-log-before-claim-done protocol', { concurrency: false }, async () => {
  const app = await makeServer();
  try {
    const create = await fetch(`${app.baseUrl}/api/kanban/task`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Needs correction', description: 'task requiring correction flow', status: 'inProgress', claimedBy: 'qa-agent', startedAt: new Date().toISOString(), updatedAt: new Date().toISOString() })
    });
    const created = await create.json();

    const missingVerification = await fetch(`${app.baseUrl}/api/kanban/move`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        taskId: created.task.id,
        to: 'done',
        completionDetails: 'Evidence: https://github.com/larryclaw/OpsHub/commit/abc123'
      })
    });
    assert.equal(missingVerification.status, 422);

    const missingCorrectionLog = await fetch(`${app.baseUrl}/api/kanban/move`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        taskId: created.task.id,
        to: 'done',
        correctionOccurred: true,
        completionDetails: 'Evidence: https://github.com/larryclaw/OpsHub/commit/abc123',
        verification: { command: 'npm test', result: 'pass', verifiedAt: new Date().toISOString() }
      })
    });
    assert.equal(missingCorrectionLog.status, 422);

    const success = await fetch(`${app.baseUrl}/api/kanban/move`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        taskId: created.task.id,
        to: 'done',
        correctionOccurred: true,
        correctionLog: { reason: 'fixed failed assertion', remediation: 'updated guard path' },
        completionDetails: 'Evidence: https://github.com/larryclaw/OpsHub/commit/abc123',
        verification: { command: 'npm test', result: 'pass', verifiedAt: new Date().toISOString() }
      })
    });
    assert.equal(success.status, 200);
  } finally {
    await app.close();
  }
});

test('blocker detection auto-spawns blocker-handler and stores blocker protocol metadata', { concurrency: false }, async () => {
  const app = await makeServer();
  try {
    const create = await fetch(`${app.baseUrl}/api/kanban/task`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Blocker card',
        description: 'blocked by auth token issue',
        status: 'inProgress',
        ...inProgressFields(),
        blockerProtocol: {
          detected: true,
          summary: 'auth token issue',
          attempts: [
            {
              agent: 'Claude Code',
              input: 'retry login flow',
              output: 'still failing',
              outcome: 'failed',
              timestamp: new Date().toISOString()
            }
          ]
        }
      })
    });
    assert.equal(create.status, 200);
    const created = await create.json();
    assert.equal(created.task.blockerProtocol.assignedAgent, 'blocker-handler');
    assert.equal(created.task.blockerProtocol.autoSpawned, true);
  } finally {
    await app.close();
  }
});

test('blocker escalation is rejected when fewer than exactly 2 Claude Code attempts are provided', { concurrency: false }, async () => {
  const app = await makeServer();
  try {
    const create = await fetch(`${app.baseUrl}/api/kanban/task`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Escalation gate task', description: 'escalation scenario task', status: 'inProgress', ...inProgressFields() })
    });
    const created = await create.json();

    const escalate = await fetch(`${app.baseUrl}/api/kanban/move`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        taskId: created.task.id,
        to: 'todo',
        blockerProtocol: {
          detected: true,
          escalation: { requested: true, category: 'auth', reason: 'cannot access auth provider' },
          attempts: [
            {
              agent: 'Claude Code',
              input: 'attempt fix #1',
              output: 'failed',
              outcome: 'failed',
              timestamp: new Date().toISOString()
            }
          ]
        }
      })
    });

    assert.equal(escalate.status, 422);
    const body = await escalate.json();
    assert.equal(body.code, 'BLOCKER_PROTOCOL_NON_COMPLIANT');
  } finally {
    await app.close();
  }
});

test('blocker escalation is allowed only with exactly 2 Claude Code attempts + allowlisted category', { concurrency: false }, async () => {
  const app = await makeServer();
  try {
    const create = await fetch(`${app.baseUrl}/api/kanban/task`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Compliant escalation task', description: 'compliant escalation scenario', status: 'inProgress', ...inProgressFields() })
    });
    const created = await create.json();

    const now = new Date().toISOString();
    const escalate = await fetch(`${app.baseUrl}/api/kanban/move`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        taskId: created.task.id,
        to: 'todo',
        blockerProtocol: {
          detected: true,
          escalation: { requested: true, category: 'permissions', reason: 'permission denied on deployment key' },
          attempts: [
            {
              agent: 'Claude Code',
              input: 'attempt fix #1',
              output: 'still blocked',
              outcome: 'failed',
              timestamp: now
            },
            {
              agent: 'Claude Code',
              input: 'attempt fix #2',
              output: 'still blocked',
              outcome: 'failed',
              timestamp: now
            }
          ]
        }
      })
    });

    assert.equal(escalate.status, 200);
    const moved = await escalate.json();
    assert.equal(moved.task.status, 'todo');
    assert.equal(moved.task.blockerProtocol.assignedAgent, 'blocker-handler');
  } finally {
    await app.close();
  }
});

test('dashboard endpoint returns integrated payload and reflects kanban inProgress tasks', { concurrency: false }, async () => {
  const app = await makeServer();
  try {
    const create = await fetch(`${app.baseUrl}/api/kanban/task`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Integration telemetry task',
        description: 'should appear in subagents.inProgressTasks',
        status: 'inProgress',
        ...inProgressFields()
      })
    });
    assert.equal(create.status, 200);

    const dashboard = await fetch(`${app.baseUrl}/api/dashboard`);
    assert.equal(dashboard.status, 200);
    const body = await dashboard.json();

    assert.ok(body.generatedAt);
    assert.equal(body.refreshSeconds, 60);

    assert.ok(body.subagents);
    assert.ok(body.liveAgentActivity);
    assert.equal(body.liveAgentActivity.title, 'Live Agent Activity');
    assert.ok(Array.isArray(body.liveAgentActivity.items));
    assert.ok(body.subagents.counts);
    assert.equal(typeof body.subagents.counts.inProgressTasks, 'number');
    assert.ok(body.subagents.counts.inProgressTasks >= 1);

    assert.ok(Array.isArray(body.subagents.inProgressTasks));
    const integrationTask = body.subagents.inProgressTasks.find((item) => item.id && item.task === 'Integration telemetry task');
    assert.ok(integrationTask);
    assert.equal(integrationTask.description, 'should appear in subagents.inProgressTasks');
    assert.equal(integrationTask.priority, 'medium');

    assert.ok(body.subagents.diagnostics);
    assert.equal(body.subagents.diagnostics.syncOk, true);
    assert.deepEqual(body.subagents.diagnostics.missingFromPayload, []);
    assert.deepEqual(body.subagents.diagnostics.tasksMissingStableId, []);

    assert.ok(body.subagents.behaviorGap);
    assert.ok(body.subagents.behaviorGap.proactiveLoop);
    assert.equal(typeof body.subagents.behaviorGap.proactiveLoop.passiveWaitRatio, 'number');
    assert.equal(body.subagents.behaviorGap.proactiveLoop.threshold, 0.15);
    assert.ok(body.subagents.behaviorGap.blockerCompliance);
    assert.equal(typeof body.subagents.behaviorGap.blockerCompliance.blockerProtocolCompliance, 'number');
    assert.equal(body.subagents.behaviorGap.blockerCompliance.threshold, 0.95);

    assert.ok(Array.isArray(body.sessions));
    assert.ok(Array.isArray(body.errors));
    assert.ok(body.tokenUsage);
    assert.equal(typeof body.tokenUsage.quotaPct, 'number');
    assert.ok(Array.isArray(body.activity));
  } finally {
    await app.close();
  }
});

test('live activity endpoint returns telemetry envelope with expected panel contract', { concurrency: false }, async () => {
  const app = await makeServer();
  try {
    const create = await fetch(`${app.baseUrl}/api/kanban/task`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Live activity endpoint task',
        description: 'Telemetry mapping fixture',
        status: 'inProgress',
        ...inProgressFields()
      })
    });
    assert.equal(create.status, 200);

    const res = await fetch(`${app.baseUrl}/api/live-activity`);
    assert.equal(res.status, 200);
    const body = await res.json();

    assert.ok(body.generatedAt);
    assert.equal(body.refreshSeconds, 15);
    assert.ok(body.liveAgentActivity);
    assert.equal(body.liveAgentActivity.title, 'Live Agent Activity');
    assert.ok(Array.isArray(body.liveAgentActivity.items));
    assert.ok(body.liveAgentActivity.counts);
    assert.equal(typeof body.liveAgentActivity.counts.sessions, 'number');
    assert.equal(typeof body.liveAgentActivity.counts.runs, 'number');
    assert.equal(typeof body.liveAgentActivity.counts.mappedTasks, 'number');
    assert.ok(body.liveAgentActivity.telemetry);
    assert.equal(typeof body.liveAgentActivity.telemetry.sessionsCommandOk, 'boolean');
    assert.equal(typeof body.liveAgentActivity.telemetry.runsCommandOk, 'boolean');
  } finally {
    await app.close();
  }
});

test('dashboard auto-next-action scheduler dispatches queued work when passive wait is detected', { concurrency: false }, async () => {
  const app = await makeServer();
  try {
    const staleInProgress = await fetch(`${app.baseUrl}/api/kanban/task`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Worker waiting task',
        description: 'waiting for instruction',
        status: 'inProgress',
        ...inProgressFields()
      })
    });
    assert.equal(staleInProgress.status, 200);

    const todo = await fetch(`${app.baseUrl}/api/kanban/task`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Auto-dispatch candidate',
        description: 'ready for next action',
        status: 'todo'
      })
    });
    assert.equal(todo.status, 200);
    const todoBody = await todo.json();

    await new Promise((resolve) => setTimeout(resolve, 20));

    const dashboard = await fetch(`${app.baseUrl}/api/dashboard`);
    assert.equal(dashboard.status, 200);
    const body = await dashboard.json();

    assert.ok(body.subagents.managerLoop.autoNextAction);
    assert.equal(typeof body.subagents.managerLoop.autoNextAction.changed, 'boolean');

    const kanban = await fetch(`${app.baseUrl}/api/kanban`);
    const kanbanBody = await kanban.json();
    const movedTask = kanbanBody.board.columns.inProgress.find((task) => task.id === todoBody.task.id);
    const hasScheduleEvent = kanbanBody.board.activityLog.some((entry) => entry.type === 'next_action_scheduled' && entry.taskId === todoBody.task.id);

    if (body.subagents.managerLoop.autoNextAction.reason === 'cooldown_active') {
      assert.equal(hasScheduleEvent, false);
      assert.equal(Boolean(movedTask), false);
    } else {
      assert.ok(movedTask);
      assert.equal(movedTask.status, 'inProgress');
      assert.equal(hasScheduleEvent, true);
    }
  } finally {
    await app.close();
  }
});

test('dashboard exposes PantryPal WIP share metric with drift alert when share drops below threshold', { concurrency: false }, async () => {
  const app = await makeServer();
  try {
    const tasks = [
      { name: 'Integration telemetry replay', status: 'inProgress', ...inProgressFields() },
      { name: 'Lifecycle replay hardening', status: 'inProgress', ...inProgressFields() },
      { name: 'Generic QA pass', status: 'inProgress', ...inProgressFields() },
      { name: 'PantryPal rescue planner tune-up', status: 'inProgress', ...inProgressFields() }
    ];

    for (const task of tasks) {
      const create = await fetch(`${app.baseUrl}/api/kanban/task`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(task)
      });
      assert.equal(create.status, 200);
    }

    const dashboard = await fetch(`${app.baseUrl}/api/dashboard`);
    assert.equal(dashboard.status, 200);
    const body = await dashboard.json();

    assert.ok(body.subagents.pantryPalWip);
    assert.ok(body.subagents.pantryPalWip.activeWipCount >= 4);
    assert.ok(body.subagents.pantryPalWip.pantryPalWipCount >= 1);
    assert.ok(body.subagents.pantryPalWip.pantryPalWipShare <= 1);
    assert.equal(body.subagents.pantryPalWip.threshold, 0.6);
    assert.equal(typeof body.subagents.pantryPalWip.driftAlert, 'boolean');

    assert.ok(body.subagents.strategicQueue);
    assert.equal(body.subagents.strategicQueue.reserveShare, 0.3);
    assert.equal(body.subagents.strategicQueue.nonStrategicCeiling, 0.7);
    assert.ok(body.subagents.strategicQueue.activeQueueCount >= 4);
    assert.equal(typeof body.subagents.strategicQueue.driftAlert, 'boolean');

    assert.ok(body.subagents.managerLoop);
    assert.ok(body.subagents.managerLoop.metrics);
    assert.equal(typeof body.subagents.managerLoop.metrics.passiveWaitRatio, 'number');
    assert.equal(typeof body.subagents.managerLoop.metrics.blockerProtocolCompliance, 'number');
    assert.ok(body.subagents.managerLoop.thresholdEvaluation);
    assert.equal(typeof body.subagents.managerLoop.thresholdEvaluation.checks.passiveWaitRatio.pass, 'boolean');
    assert.equal(typeof body.subagents.managerLoop.thresholdEvaluation.checks.blockerProtocolCompliance.pass, 'boolean');
  } finally {
    await app.close();
  }
});


test('moving complex task to inProgress enforces delegation trigger metadata', { concurrency: false }, async () => {
  const app = await makeServer();
  try {
    const create = await fetch(`${app.baseUrl}/api/kanban/task`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Complex MGAP task',
        status: 'todo',
        description: 'Acceptance criteria:\n- step one\n- step two\n- step three'
      })
    });
    const created = await create.json();

    const move = await fetch(`${app.baseUrl}/api/kanban/move`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ taskId: created.task.id, to: 'inProgress', summary: 'delegating now', ...inProgressFields() })
    });
    assert.equal(move.status, 200);
    const body = await move.json();
    assert.equal(body.task.delegation.required, true);

    const boardRes = await fetch(`${app.baseUrl}/api/kanban`);
    const boardBody = await boardRes.json();
    const reminder = boardBody.board.activityLog.find((entry) => entry.type === 'delegation_triggered' && entry.taskId === created.task.id);
    assert.ok(reminder);
  } finally {
    await app.close();
  }
});

test('failed done transition logs closeout contract reminder activity', { concurrency: false }, async () => {
  const app = await makeServer();
  try {
    const create = await fetch(`${app.baseUrl}/api/kanban/task`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Closeout policy target', description: 'done-policy test target', status: 'inProgress', ...inProgressFields() })
    });
    const created = await create.json();

    const move = await fetch(`${app.baseUrl}/api/kanban/move`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        taskId: created.task.id,
        to: 'done',
        completionDetails: 'Evidence: artifacts/local.md'
      })
    });
    assert.equal(move.status, 400);

    const boardRes = await fetch(`${app.baseUrl}/api/kanban`);
    const boardBody = await boardRes.json();
    const reminder = boardBody.board.activityLog.find(
      (entry) => entry.type === 'closeout_contract_reminder' && entry.taskId === created.task.id
    );
    assert.ok(reminder);
  } finally {
    await app.close();
  }
});

test('agent activity summary endpoint returns all active sessions', { concurrency: false }, async () => {
  const fixture = path.join(__dirname, 'fixtures', 'agent-telemetry.fixture.json');
  const app = await makeServer({ telemetryFixture: fixture });
  try {
    const res = await fetch(`${app.baseUrl}/api/agent-activity/summary`);
    assert.equal(res.status, 200);
    const body = await res.json();

    assert.equal(body.refreshSeconds, 5);
    assert.equal(body.counts.activeSessions, 1);
    assert.equal(body.counts.sessionsWithToolEvents, 1);
    assert.equal(body.agents[0].sessionKey, 'agent:vibe-coder:subagent:abc');
    assert.equal(body.agents[0].toolEventCount, 2);
  } finally {
    await app.close();
  }
});

test('agent activity trace endpoint returns redacted timeline payload', { concurrency: false }, async () => {
  const fixture = path.join(__dirname, 'fixtures', 'agent-telemetry.fixture.json');
  const app = await makeServer({ telemetryFixture: fixture });
  try {
    const key = encodeURIComponent('agent:vibe-coder:subagent:abc');
    const res = await fetch(`${app.baseUrl}/api/agent-activity/trace/${key}`);
    assert.equal(res.status, 200);
    const body = await res.json();

    assert.equal(body.timeline.length, 2);
    const serialized = JSON.stringify(body.timeline);
    assert.doesNotMatch(serialized, /ghp_[A-Za-z0-9]+/);
    assert.doesNotMatch(serialized, /Bearer\s+[A-Za-z0-9._-]+/);
    assert.match(serialized, /\[REDACTED/);
  } finally {
    await app.close();
  }
});
