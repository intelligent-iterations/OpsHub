const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('os');
const fs = require('fs/promises');
const path = require('path');

const { startServer } = require('../server');

async function makeServer() {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'opshub-test-'));
  process.env.OPSHUB_DATA_DIR = tempDir;

  const server = startServer(0);
  await new Promise((resolve) => server.once('listening', resolve));

  const { port } = server.address();
  const baseUrl = `http://127.0.0.1:${port}`;

  return {
    baseUrl,
    close: async () => {
      await new Promise((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
      await fs.rm(tempDir, { recursive: true, force: true });
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
      body: JSON.stringify({ name: 'Smoke task', description: 'verify kanban', priority: 'high' })
    });
    assert.equal(create.status, 200);
    const createBody = await create.json();
    assert.equal(createBody.ok, true);
    assert.equal(createBody.task.ttlMinutes, 60);
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
        verification: 'unit tests passed',
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

test('kanban lifecycle preserves completedAt semantics when reopened', { concurrency: false }, async () => {
  const app = await makeServer();
  try {
    const create = await fetch(`${app.baseUrl}/api/kanban/task`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Lifecycle task',
        status: 'done',
        verification: 'smoke checks passed',
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
        verification: 'regression checks complete',
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
      body: JSON.stringify({ name: 'Move target', status: 'todo' })
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

    const goodMove = await fetch(`${app.baseUrl}/api/kanban/move`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        taskId: created.task.id,
        to: 'done',
        completionDetails: 'Evidence: https://github.com/larryclaw/OpsHub/commit/abc123',
        verification: 'qa-evidence-check passed'
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
      body: JSON.stringify({ name: 'Needs correction', status: 'inProgress' })
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

test('dashboard endpoint returns integrated payload and reflects kanban inProgress tasks', { concurrency: false }, async () => {
  const app = await makeServer();
  try {
    const create = await fetch(`${app.baseUrl}/api/kanban/task`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Integration dashboard task',
        description: 'should appear in subagents.inProgressTasks',
        status: 'inProgress'
      })
    });
    assert.equal(create.status, 200);

    const dashboard = await fetch(`${app.baseUrl}/api/dashboard`);
    assert.equal(dashboard.status, 200);
    const body = await dashboard.json();

    assert.ok(body.generatedAt);
    assert.equal(body.refreshSeconds, 60);

    assert.ok(body.subagents);
    assert.ok(body.subagents.counts);
    assert.equal(typeof body.subagents.counts.inProgressTasks, 'number');
    assert.ok(body.subagents.counts.inProgressTasks >= 1);

    assert.ok(Array.isArray(body.subagents.inProgressTasks));
    const integrationTask = body.subagents.inProgressTasks.find((item) => item.id && item.task === 'Integration dashboard task');
    assert.ok(integrationTask);
    assert.equal(integrationTask.description, 'should appear in subagents.inProgressTasks');
    assert.equal(integrationTask.priority, 'medium');

    assert.ok(body.subagents.diagnostics);
    assert.equal(body.subagents.diagnostics.syncOk, true);
    assert.deepEqual(body.subagents.diagnostics.missingFromPayload, []);
    assert.deepEqual(body.subagents.diagnostics.tasksMissingStableId, []);

    assert.ok(Array.isArray(body.sessions));
    assert.ok(Array.isArray(body.errors));
    assert.ok(body.tokenUsage);
    assert.equal(typeof body.tokenUsage.quotaPct, 'number');
    assert.ok(Array.isArray(body.activity));
  } finally {
    await app.close();
  }
});

test('dashboard exposes PantryPal WIP share metric with drift alert when share drops below threshold', { concurrency: false }, async () => {
  const app = await makeServer();
  try {
    const tasks = [
      { name: 'Integration dashboard task', status: 'inProgress' },
      { name: 'Smoke lifecycle replay', status: 'inProgress' },
      { name: 'Generic QA pass', status: 'inProgress' },
      { name: 'PantryPal rescue planner tune-up', status: 'inProgress' }
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
  } finally {
    await app.close();
  }
});
