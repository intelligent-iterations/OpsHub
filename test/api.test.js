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

test('health endpoint returns ok', async () => {
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

test('kanban create + move flow works and validates bad input', async () => {
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
      body: JSON.stringify({ taskId, to: 'done', summary: 'finished' })
    });
    assert.equal(move.status, 200);
    const moveBody = await move.json();
    assert.equal(moveBody.task.status, 'done');
    assert.ok(moveBody.task.completedAt);
  } finally {
    await app.close();
  }
});

test('kanban lifecycle preserves completedAt semantics when reopened', async () => {
  const app = await makeServer();
  try {
    const create = await fetch(`${app.baseUrl}/api/kanban/task`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Lifecycle task', status: 'done' })
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
      body: JSON.stringify({ taskId, to: 'done', summary: 'finally done' })
    });
    assert.equal(reclose.status, 200);
    const reclosed = await reclose.json();
    assert.equal(reclosed.task.status, 'done');
    assert.ok(reclosed.task.completedAt);
  } finally {
    await app.close();
  }
});

test('dashboard endpoint returns integrated payload and reflects kanban inProgress tasks', async () => {
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

    assert.ok(body.subagents.gateway);
    assert.ok(['ok', 'degraded', 'unavailable'].includes(body.subagents.gateway.status));
    assert.ok(body.subagents.gateway.polledAt);
    assert.ok(body.subagents.gateway.diagnostics);

    assert.ok(Array.isArray(body.sessions));
    assert.ok(Array.isArray(body.errors));
    assert.ok(body.tokenUsage);
    assert.equal(typeof body.tokenUsage.quotaPct, 'number');
    assert.ok(Array.isArray(body.activity));
  } finally {
    await app.close();
  }
});
