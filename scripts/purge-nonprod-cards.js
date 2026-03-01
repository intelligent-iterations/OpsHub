#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

function parseArgs(argv = process.argv) {
  const args = {
    kanban: path.resolve(__dirname, '..', 'data', 'kanban.json'),
    apply: false,
    backupOut: null
  };

  for (let i = 2; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === '--kanban') args.kanban = path.resolve(argv[++i]);
    else if (token === '--backup-out') args.backupOut = path.resolve(argv[++i]);
    else if (token === '--apply') args.apply = true;
    else if (token === '-h' || token === '--help') {
      console.log('Usage: node scripts/purge-nonprod-cards.js [--kanban <path>] [--backup-out <path>] [--apply]');
      process.exit(0);
    } else {
      throw new Error(`Unknown arg: ${token}`);
    }
  }
  return args;
}

function isSyntheticOrTestCard(task = {}) {
  const name = String(task.name || '').toLowerCase();
  const description = String(task.description || '').toLowerCase();
  const source = String(task.source || '').toLowerCase();

  const syntheticIntegration = name === 'integration dashboard task'
    && source === 'manual'
    && description.includes('should appear in subagents.inprogresstasks');

  const explicitTestMarker = /\b(test|smoke|fixture|dummy|sandbox)\b/.test(name)
    || /\b(test|smoke|fixture|dummy|sandbox)\b/.test(description);

  return syntheticIntegration || explicitTestMarker;
}

function analyzeBoard(board) {
  const columns = board?.columns || {};
  const report = { removedByColumn: {}, removed: [] };

  for (const [column, tasks] of Object.entries(columns)) {
    const list = Array.isArray(tasks) ? tasks : [];
    const flagged = list.filter(isSyntheticOrTestCard);
    report.removedByColumn[column] = flagged.length;
    for (const task of flagged) {
      report.removed.push({ column, id: task.id, name: task.name });
    }
  }

  report.totalRemoved = report.removed.length;
  return report;
}

function applyPurge(board) {
  const out = JSON.parse(JSON.stringify(board || { columns: {}, activityLog: [] }));
  for (const [column, tasks] of Object.entries(out.columns || {})) {
    if (!Array.isArray(tasks)) continue;
    out.columns[column] = tasks.filter((task) => !isSyntheticOrTestCard(task));
  }
  if (!Array.isArray(out.activityLog)) out.activityLog = [];
  out.activityLog.unshift({
    at: new Date().toISOString(),
    type: 'cleanup_nonprod_cards',
    detail: 'Purged synthetic/test cards via purge-nonprod-cards script.'
  });
  return out;
}

function main() {
  const args = parseArgs(process.argv);
  const board = JSON.parse(fs.readFileSync(args.kanban, 'utf8'));
  const report = analyzeBoard(board);

  if (!args.apply) {
    process.stdout.write(`${JSON.stringify({ apply: false, report }, null, 2)}\n`);
    return;
  }

  const next = applyPurge(board);
  if (args.backupOut) {
    fs.mkdirSync(path.dirname(args.backupOut), { recursive: true });
    fs.writeFileSync(args.backupOut, JSON.stringify(board, null, 2) + '\n', 'utf8');
  }
  fs.writeFileSync(args.kanban, JSON.stringify(next, null, 2) + '\n', 'utf8');
  process.stdout.write(`${JSON.stringify({ apply: true, report, kanban: args.kanban, backupOut: args.backupOut }, null, 2)}\n`);
}

module.exports = { parseArgs, isSyntheticOrTestCard, analyzeBoard, applyPurge };

if (require.main === module) {
  try { main(); } catch (err) { console.error(`purge-nonprod-cards failed: ${err.message}`); process.exit(1); }
}
