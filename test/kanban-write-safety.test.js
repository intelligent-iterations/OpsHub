const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const {
  DEFAULT_PRODUCTION_KANBAN_PATH,
  isProductionKanbanPath,
  enforceApiOnlyProductionWrite,
} = require('../lib/kanban-write-safety');

test('isProductionKanbanPath identifies canonical production board path', () => {
  assert.equal(isProductionKanbanPath(DEFAULT_PRODUCTION_KANBAN_PATH), true);
  assert.equal(isProductionKanbanPath(path.join(path.dirname(DEFAULT_PRODUCTION_KANBAN_PATH), '..', 'data', 'kanban.json')), true);
  assert.equal(isProductionKanbanPath(path.join(path.dirname(DEFAULT_PRODUCTION_KANBAN_PATH), 'kanban-test.json')), false);
});

test('enforceApiOnlyProductionWrite blocks script actors on production board and allows api actor', () => {
  const blocked = enforceApiOnlyProductionWrite({
    kanbanPath: DEFAULT_PRODUCTION_KANBAN_PATH,
    actor: 'script_social_mention_enqueue',
  });
  assert.equal(blocked.ok, false);
  assert.equal(blocked.code, 'PRODUCTION_BOARD_API_ONLY');

  const allowedApi = enforceApiOnlyProductionWrite({
    kanbanPath: DEFAULT_PRODUCTION_KANBAN_PATH,
    actor: 'api',
  });
  assert.equal(allowedApi.ok, true);

  const allowedTemp = enforceApiOnlyProductionWrite({
    kanbanPath: '/tmp/opshub-test-kanban.json',
    actor: 'script_auto_seed_queue_task',
  });
  assert.equal(allowedTemp.ok, true);
});
