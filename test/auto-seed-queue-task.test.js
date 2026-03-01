const test = require('node:test');
const assert = require('node:assert/strict');
const { mkdtemp, rm, writeFile, readFile } = require('node:fs/promises');
const { join, resolve } = require('node:path');
const { tmpdir } = require('node:os');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');

const execFileAsync = promisify(execFile);
const scriptPath = resolve(__dirname, '..', 'scripts', 'auto-seed-queue-task.js');
const { DEFAULT_PRODUCTION_KANBAN_PATH } = require('../lib/kanban-write-safety');

function emptyBoard() {
  return {
    columns: { backlog: [], todo: [], inProgress: [], done: [] },
    activityLog: []
  };
}

test('auto-seed blocks synthetic title in production mode', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'auto-seed-synth-prod-'));
  const kanbanPath = join(dir, 'kanban.json');
  try {
    await writeFile(kanbanPath, JSON.stringify(emptyBoard(), null, 2), 'utf8');

    const { stdout } = await execFileAsync('node', [
      scriptPath,
      '--kanban', kanbanPath,
      '--mode', 'production',
      '--title', 'Integration dashboard task'
    ]);
    const report = JSON.parse(stdout);

    assert.equal(report.seeded, false);
    assert.equal(report.blockedSynthetic, true);
    assert.equal(report.blockCode, 'TASK_ADMISSION_SYNTHETIC_DENIED');

    const board = JSON.parse(await readFile(kanbanPath, 'utf8'));
    assert.equal(board.columns.todo.length, 0);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('auto-seed allows synthetic title in diagnostic mode', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'auto-seed-synth-diag-'));
  const kanbanPath = join(dir, 'kanban.json');
  try {
    await writeFile(kanbanPath, JSON.stringify(emptyBoard(), null, 2), 'utf8');

    const { stdout } = await execFileAsync('node', [
      scriptPath,
      '--kanban', kanbanPath,
      '--mode', 'diagnostic',
      '--title', 'Integration dashboard task'
    ]);
    const report = JSON.parse(stdout);

    assert.equal(report.seeded, true);
    assert.equal(report.blockedSynthetic, false);

    const board = JSON.parse(await readFile(kanbanPath, 'utf8'));
    assert.equal(board.columns.todo.length, 1);
    assert.equal(board.columns.todo[0].name, 'Integration dashboard task');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('auto-seed cannot mutate production board path outside API', async () => {
  const before = await readFile(DEFAULT_PRODUCTION_KANBAN_PATH, 'utf8');
  const { stdout } = await execFileAsync('node', [
    scriptPath,
    '--kanban', DEFAULT_PRODUCTION_KANBAN_PATH,
    '--mode', 'diagnostic',
    '--title', 'Integration dashboard task'
  ]);
  const report = JSON.parse(stdout);

  assert.equal(report.seeded, false);
  assert.equal(report.blockCode, 'PRODUCTION_BOARD_API_ONLY');

  const after = await readFile(DEFAULT_PRODUCTION_KANBAN_PATH, 'utf8');
  assert.equal(after, before);
});
