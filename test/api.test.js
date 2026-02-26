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
