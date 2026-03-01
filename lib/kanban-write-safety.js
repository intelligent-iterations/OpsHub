'use strict';

const path = require('path');

const OPSHUB_DIR = path.resolve(__dirname, '..');
const DEFAULT_PRODUCTION_KANBAN_PATH = path.join(OPSHUB_DIR, 'data', 'kanban.json');

function normalizePath(inputPath) {
  return path.resolve(String(inputPath || ''));
}

function isProductionKanbanPath(kanbanPath) {
  if (!kanbanPath) return false;
  return normalizePath(kanbanPath) === normalizePath(DEFAULT_PRODUCTION_KANBAN_PATH);
}

function enforceApiOnlyProductionWrite({ kanbanPath, actor = 'script' } = {}) {
  if (!isProductionKanbanPath(kanbanPath)) return { ok: true, code: null, error: null };
  if (actor === 'api') return { ok: true, code: null, error: null };

  return {
    ok: false,
    code: 'PRODUCTION_BOARD_API_ONLY',
    error: 'production kanban writes are restricted to OpsHub API routes',
    details: {
      actor,
      kanbanPath: normalizePath(kanbanPath),
      productionKanbanPath: normalizePath(DEFAULT_PRODUCTION_KANBAN_PATH),
    },
  };
}

module.exports = {
  DEFAULT_PRODUCTION_KANBAN_PATH,
  isProductionKanbanPath,
  enforceApiOnlyProductionWrite,
};
