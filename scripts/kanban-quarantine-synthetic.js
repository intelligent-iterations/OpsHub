#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const SYNTHETIC_NAME = 'integration dashboard task';
const ROLLUP_ID = 'quarantine-synthetic-integration-dashboard-task-rollup';

function parseArgs(argv) {
  const args = {
    kanban: path.resolve(__dirname, '..', 'data', 'kanban.json'),
    apply: false,
    report: false,
    reportJsonOut: null,
    reportMdOut: null
  };

  for (let i = 2; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === '--kanban') args.kanban = path.resolve(argv[++i]);
    else if (token === '--apply') args.apply = true;
    else if (token === '--report') args.report = true;
    else if (token === '--report-json-out') args.reportJsonOut = path.resolve(argv[++i]);
    else if (token === '--report-md-out') args.reportMdOut = path.resolve(argv[++i]);
    else if (token === '--help' || token === '-h') {
      printHelp();
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${token}`);
    }
  }

  if (!args.apply && !args.report) {
    args.report = true;
  }

  return args;
}

function printHelp() {
  console.log(`kanban-quarantine-synthetic\n\nUsage:\n  node scripts/kanban-quarantine-synthetic.js [options]\n\nOptions:\n  --kanban <path>           Path to kanban.json (default: OpsHub/data/kanban.json)\n  --report                  Generate quarantine report (default mode)\n  --apply                   Apply quarantine changes to kanban\n  --report-json-out <path>  Write JSON report\n  --report-md-out <path>    Write markdown report\n  -h, --help                Show help`);
}

function normalizeBoard(board) {
  return {
    columns: {
      backlog: Array.isArray(board?.columns?.backlog) ? board.columns.backlog : [],
      todo: Array.isArray(board?.columns?.todo) ? board.columns.todo : [],
      inProgress: Array.isArray(board?.columns?.inProgress) ? board.columns.inProgress : [],
      done: Array.isArray(board?.columns?.done) ? board.columns.done : []
    },
    activityLog: Array.isArray(board?.activityLog) ? board.activityLog : []
  };
}

function normalizeText(value) {
  return String(value || '').trim().toLowerCase();
}

function isSyntheticIntegrationTask(task) {
  const nameMatch = normalizeText(task?.name) === SYNTHETIC_NAME;
  if (!nameMatch) return false;

  const source = normalizeText(task?.source);
  const description = normalizeText(task?.description);
  const integrationMarker = description.includes('should appear in subagents.inprogresstasks');
  return source === 'manual' || integrationMarker;
}

function detectSyntheticCards(board) {
  const out = [];
  for (const column of ['backlog', 'todo', 'inProgress']) {
    for (const task of board.columns[column]) {
      if (!isSyntheticIntegrationTask(task)) continue;
      out.push({
        taskId: task.id,
        taskName: task.name,
        column,
        source: task.source || null,
        createdAt: task.createdAt || null,
        reason: 'matches synthetic Integration dashboard task fingerprint'
      });
    }
  }
  return out;
}

function buildRollupCard(candidates, nowIso) {
  const ids = candidates.map((c) => c.taskId).filter(Boolean);
  const byColumn = candidates.reduce((acc, row) => {
    acc[row.column] = (acc[row.column] || 0) + 1;
    return acc;
  }, {});

  return {
    id: ROLLUP_ID,
    name: '[Quarantine] Synthetic "Integration dashboard task" cards',
    description:
      `Auto-generated quarantine rollup.\n` +
      `Captured synthetic cards: ${candidates.length}.\n` +
      `Columns: backlog=${byColumn.backlog || 0}, todo=${byColumn.todo || 0}, inProgress=${byColumn.inProgress || 0}.\n` +
      `Task IDs: ${ids.join(', ')}`,
    priority: 'low',
    status: 'backlog',
    source: 'kanban-quarantine-synthetic',
    createdAt: nowIso,
    updatedAt: nowIso,
    completedAt: null,
    metadata: {
      quarantineType: 'synthetic-integration-dashboard-task',
      quarantinedCount: candidates.length,
      quarantinedTaskIds: ids,
      columns: byColumn
    }
  };
}

function applyQuarantine(board, candidates, options = {}) {
  const nowIso = options.nowIso || new Date().toISOString();
  const out = normalizeBoard(board);
  const ids = new Set(candidates.map((c) => c.taskId));

  out.columns.todo = out.columns.todo.filter((task) => !ids.has(task.id));
  out.columns.inProgress = out.columns.inProgress.filter((task) => !ids.has(task.id));
  out.columns.backlog = out.columns.backlog.filter(
    (task) => task.id !== ROLLUP_ID && !ids.has(task.id)
  );

  if (candidates.length > 0) {
    const rollup = buildRollupCard(candidates, nowIso);
    out.columns.backlog.unshift(rollup);

    for (const item of candidates) {
      out.activityLog.unshift({
        at: nowIso,
        type: 'task_quarantined',
        taskId: item.taskId,
        taskName: item.taskName,
        from: item.column,
        to: 'backlog',
        detail: 'Auto-quarantined by kanban-quarantine-synthetic script.'
      });
    }

    out.activityLog.unshift({
      at: nowIso,
      type: 'quarantine_rollup_updated',
      taskId: ROLLUP_ID,
      taskName: '[Quarantine] Synthetic "Integration dashboard task" cards',
      detail: `Quarantined ${candidates.length} synthetic cards.`
    });
  }

  out.activityLog = out.activityLog.slice(0, 500);

  return {
    board: out,
    movedTaskIds: [...ids],
    rollupId: candidates.length > 0 ? ROLLUP_ID : null
  };
}

function toMarkdown(report) {
  const lines = [];
  lines.push('# Kanban Synthetic Card Quarantine Report');
  lines.push('');
  lines.push(`Generated: ${report.generatedAt}`);
  lines.push(`Mode: ${report.applyMode ? 'apply' : 'report'}`);
  lines.push(`Kanban: ${report.kanbanPath}`);
  lines.push('');
  lines.push('## Summary');
  lines.push('');
  lines.push(`- Synthetic candidates detected: **${report.summary.syntheticCandidates}**`);
  lines.push(`- Quarantined in apply mode: **${report.summary.quarantinedCount}**`);
  lines.push(`- Rollup card id: **${report.summary.rollupId || 'none'}**`);
  lines.push('');

  if (report.syntheticCandidates.length === 0) {
    lines.push('_No synthetic cards matched the quarantine policy._');
    return lines.join('\n');
  }

  lines.push('## Synthetic Candidates');
  lines.push('');
  for (const row of report.syntheticCandidates) {
    lines.push(`- \`${row.taskId}\` in **${row.column}** (${row.source || 'unknown source'})`);
  }

  return lines.join('\n');
}

function writeJson(filePath, payload) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(payload, null, 2), 'utf8');
}

function writeText(filePath, payload) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, payload, 'utf8');
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

async function main() {
  const args = parseArgs(process.argv);
  const original = normalizeBoard(readJson(args.kanban));
  const candidates = detectSyntheticCards(original);

  let applied = { board: original, movedTaskIds: [], rollupId: null };
  if (args.apply) {
    applied = applyQuarantine(original, candidates);
    fs.writeFileSync(args.kanban, JSON.stringify(applied.board, null, 2), 'utf8');
  }

  const report = {
    generatedAt: new Date().toISOString(),
    kanbanPath: args.kanban,
    applyMode: args.apply,
    syntheticCandidates: candidates,
    movedTaskIds: applied.movedTaskIds,
    summary: {
      syntheticCandidates: candidates.length,
      quarantinedCount: applied.movedTaskIds.length,
      rollupId: applied.rollupId
    }
  };

  const markdown = toMarkdown(report);

  if (args.reportJsonOut) writeJson(args.reportJsonOut, report);
  if (args.reportMdOut) writeText(args.reportMdOut, markdown);
  if (!args.reportJsonOut) process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  if (!args.reportMdOut) process.stdout.write(`\n${markdown}\n`);
}

module.exports = {
  parseArgs,
  isSyntheticIntegrationTask,
  detectSyntheticCards,
  buildRollupCard,
  applyQuarantine,
  toMarkdown,
  main
};

if (require.main === module) {
  main().catch((err) => {
    console.error(`kanban-quarantine-synthetic failed: ${err.message}`);
    process.exit(1);
  });
}
