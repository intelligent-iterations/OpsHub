const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const {
  parseCliOptions,
  validateOptions,
  appendCycleEvidence
} = require('../scripts/claude-cycle-log.js');

/* ── parseCliOptions ─────────────────────────────────────────────── */

test('parseCliOptions extracts all flags (space-separated)', () => {
  const opts = parseCliOptions([
    '--task-id', 'T-1',
    '--task-name', 'Fix bug',
    '--github-link', 'https://github.com/org/repo/pull/1',
    '--correction-log', 'corrected drift'
  ]);
  assert.equal(opts.taskId, 'T-1');
  assert.equal(opts.taskName, 'Fix bug');
  assert.equal(opts.githubLink, 'https://github.com/org/repo/pull/1');
  assert.equal(opts.correctionLog, 'corrected drift');
});

test('parseCliOptions handles equals-separated values', () => {
  const opts = parseCliOptions([
    '--task-id=T-2',
    '--task-name=Deploy fix',
    '--github-link=https://github.com/org/repo/pull/2',
    '--correction-log=summary text'
  ]);
  assert.equal(opts.taskId, 'T-2');
  assert.equal(opts.taskName, 'Deploy fix');
});

/* ── validateOptions ─────────────────────────────────────────────── */

test('validateOptions reports missing required args', () => {
  const result = validateOptions({});
  assert.equal(result.ok, false);
  assert.match(result.error, /--task-id/);
  assert.match(result.error, /--github-link/);
});

test('validateOptions rejects non-GitHub links', () => {
  const result = validateOptions({
    taskId: 'T-1',
    taskName: 'X',
    githubLink: 'https://example.com/repo',
    correctionLog: 'text'
  });
  assert.equal(result.ok, false);
  assert.match(result.error, /Invalid GitHub link/);
});

test('validateOptions rejects malformed URLs', () => {
  const result = validateOptions({
    taskId: 'T-1',
    taskName: 'X',
    githubLink: 'not-a-url',
    correctionLog: 'text'
  });
  assert.equal(result.ok, false);
  assert.match(result.error, /Invalid GitHub link/);
});

test('validateOptions accepts valid GitHub links', () => {
  const result = validateOptions({
    taskId: 'T-1',
    taskName: 'X',
    githubLink: 'https://github.com/org/repo/pull/5',
    correctionLog: 'text'
  });
  assert.equal(result.ok, true);
});

/* ── appendCycleEvidence ─────────────────────────────────────────── */

test('appendCycleEvidence appends entry to kanban activityLog', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cycle-log-'));
  const kanbanPath = path.join(tmpDir, 'kanban.json');

  const seed = { columns: { todo: [], inProgress: [], done: [] }, activityLog: [] };
  fs.writeFileSync(kanbanPath, JSON.stringify(seed, null, 2), 'utf8');

  const entry = appendCycleEvidence({
    taskId: 'PP-001',
    taskName: '[PantryPal] Test task',
    githubLink: 'https://github.com/org/repo/pull/10',
    correctionLog: 'fixed drift in scoring',
    kanbanFile: kanbanPath
  });

  assert.equal(entry.type, 'claude_cycle_evidence');
  assert.equal(entry.taskId, 'PP-001');
  assert.equal(entry.taskName, '[PantryPal] Test task');
  assert.equal(entry.to, 'done');
  assert.match(entry.detail, /github\.com/);
  assert.match(entry.detail, /fixed drift in scoring/);
  assert.ok(entry.at);

  const kanban = JSON.parse(fs.readFileSync(kanbanPath, 'utf8'));
  assert.equal(kanban.activityLog.length, 1);
  assert.equal(kanban.activityLog[0].type, 'claude_cycle_evidence');

  fs.rmSync(tmpDir, { recursive: true });
});

test('appendCycleEvidence prepends to existing log entries', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cycle-log-'));
  const kanbanPath = path.join(tmpDir, 'kanban.json');

  const seed = {
    columns: { todo: [], inProgress: [], done: [] },
    activityLog: [{ at: '2026-01-01T00:00:00.000Z', type: 'task_added', taskId: 'OLD' }]
  };
  fs.writeFileSync(kanbanPath, JSON.stringify(seed, null, 2), 'utf8');

  appendCycleEvidence({
    taskId: 'PP-002',
    taskName: 'New task',
    githubLink: 'https://github.com/org/repo/pull/11',
    correctionLog: 'remediation',
    kanbanFile: kanbanPath
  });

  const kanban = JSON.parse(fs.readFileSync(kanbanPath, 'utf8'));
  assert.equal(kanban.activityLog.length, 2);
  assert.equal(kanban.activityLog[0].taskId, 'PP-002');
  assert.equal(kanban.activityLog[1].taskId, 'OLD');

  fs.rmSync(tmpDir, { recursive: true });
});
