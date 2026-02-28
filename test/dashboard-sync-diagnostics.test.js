const test = require('node:test');
const assert = require('node:assert/strict');

const { normalizeInProgressTask, buildInProgressSyncDiagnostics } = require('../server');

test('normalizeInProgressTask assigns fallback id and sane defaults', () => {
  const normalized = normalizeInProgressTask({ name: 'Task without id' }, 4);
  assert.equal(normalized.id, 'kanban-inprogress-4');
  assert.equal(normalized.task, 'Task without id');
  assert.equal(normalized.priority, 'medium');
  assert.equal(normalized._kanbanId, null);
});

test('buildInProgressSyncDiagnostics reports missing stable ids as sync drift', () => {
  const raw = [{ name: 'Task without id' }];
  const payload = [normalizeInProgressTask(raw[0], 0)];
  const diagnostics = buildInProgressSyncDiagnostics(raw, payload);

  assert.equal(diagnostics.syncOk, false);
  assert.equal(diagnostics.kanbanInProgressCount, 1);
  assert.equal(diagnostics.payloadInProgressCount, 1);
  assert.deepEqual(diagnostics.missingFromPayload, []);
  assert.equal(diagnostics.tasksMissingStableId.length, 1);
});
