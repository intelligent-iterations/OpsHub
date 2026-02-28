const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('node:child_process');

const checkerPath = path.resolve(__dirname, '..', 'scripts', 'qa-evidence-integrity-checker.js');
const checker = require('../scripts/qa-evidence-integrity-checker');

function makeTempWorkspace() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'qa-evidence-checker-'));
}

function writeKanban(dir, doneTasks) {
  const kanbanPath = path.join(dir, 'kanban.json');
  fs.writeFileSync(
    kanbanPath,
    JSON.stringify({ columns: { backlog: [], todo: [], inProgress: [], done: doneTasks }, activityLog: [] }, null, 2),
    'utf8'
  );
  return kanbanPath;
}

function runChecker(args) {
  return spawnSync(process.execPath, [checkerPath, ...args], {
    encoding: 'utf8'
  });
}

test('parseArgs reads rollback flag', () => {
  const args = checker.parseArgs(['node', checkerPath, '--apply-rollback']);
  assert.equal(args.applyRollback, true);
});

test('checkTask fails when correction occurred without correction log', () => {
  const tempDir = makeTempWorkspace();
  try {
    const task = {
      id: 'c1',
      name: 'Correction task',
      status: 'done',
      completionDetails: 'Evidence: https://github.com/example/repo/commit/abc',
      metadata: {
        correctionOccurred: true,
        verification: { command: 'npm test', result: 'pass' }
      }
    };
    const result = checker.checkTask(task, { kanbanDir: tempDir, artifactsDir: tempDir });
    assert.equal(result.pass, false);
    assert.equal(result.issues.some((i) => i.code === 'MISSING_CORRECTION_LOG'), true);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test('applyRollback moves failing done tasks back to inProgress', () => {
  const board = {
    columns: {
      backlog: [],
      todo: [],
      inProgress: [],
      done: [{ id: 't1', name: 'Failing done', status: 'done', completedAt: '2026-01-01T00:00:00.000Z' }]
    },
    activityLog: []
  };

  const rolledBack = checker.applyRollback(board, [
    { taskId: 't1', issues: [{ code: 'MISSING_VERIFICATION_RECORD' }] }
  ]);

  assert.deepEqual(rolledBack, ['t1']);
  assert.equal(board.columns.done.length, 0);
  assert.equal(board.columns.inProgress[0].id, 't1');
  assert.equal(board.activityLog[0].type, 'qa_gate_rollback');
});

test('cli rollback path writes updated kanban and exits non-zero on failure threshold', () => {
  const tempDir = makeTempWorkspace();
  try {
    const kanbanPath = writeKanban(tempDir, [
      {
        id: 'task-1',
        name: 'Task missing verification',
        status: 'done',
        completionDetails: 'Evidence: https://github.com/example/repo/commit/abc'
      }
    ]);

    const result = runChecker([
      '--kanban',
      kanbanPath,
      '--artifacts-dir',
      tempDir,
      '--apply-rollback',
      '--max-errors',
      '0'
    ]);
    assert.equal(result.status, 1);

    const board = JSON.parse(fs.readFileSync(kanbanPath, 'utf8'));
    assert.equal(board.columns.done.length, 0);
    assert.equal(board.columns.inProgress.length, 1);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});
