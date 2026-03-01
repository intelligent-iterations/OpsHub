#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { normalizeMode, evaluateSyntheticWriteGuard } = require('../lib/synthetic-write-guard');
const { enforceApiOnlyProductionWrite } = require('../lib/kanban-write-safety');

function parseArgs(argv) {
  const args = {
    kanban: path.resolve(__dirname, '..', 'data', 'kanban.json'),
    reportOut: null,
    title: '[P29][Growth] Add weekly win-back push notification A/B experiment brief',
    priority: 'high',
    mode: process.env.OPSHUB_BOARD_MODE || 'production'
  };

  for (let i = 2; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === '--kanban') args.kanban = path.resolve(argv[++i]);
    else if (token === '--report-out') args.reportOut = path.resolve(argv[++i]);
    else if (token === '--title') args.title = argv[++i];
    else if (token === '--priority') args.priority = argv[++i];
    else if (token === '--mode') args.mode = argv[++i];
    else if (token === '--help' || token === '-h') {
      console.log('Usage: node scripts/auto-seed-queue-task.js [--kanban <path>] [--report-out <path>] [--title <text>] [--priority <low|medium|high>] [--mode <production|diagnostic>]');
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${token}`);
    }
  }

  return args;
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

function main() {
  const args = parseArgs(process.argv);
  const nowIso = new Date().toISOString();

  const board = normalizeBoard(JSON.parse(fs.readFileSync(args.kanban, 'utf8')));
  const queueLight = board.columns.todo.length + board.columns.inProgress.length === 0;

  const boardMode = normalizeMode(args.mode);
  const defaultDescription = [
    'Acceptance criteria:',
    '1) Produce artifact: artifacts/p29-winback-experiment-brief.md with 3 testable hypotheses.',
    '2) Include success metrics (activation lift, 7-day retention, CTR) and guardrails.',
    '3) Add implementation checklist for tracking + rollout + stop conditions.'
  ].join('\n');

  const report = {
    generatedAt: nowIso,
    queueLight,
    mode: boardMode,
    seeded: false,
    blockedSynthetic: false,
    blockCode: null,
    taskId: null,
    taskName: args.title,
    kanbanPath: args.kanban
  };

  const productionWriteGuard = enforceApiOnlyProductionWrite({
    kanbanPath: args.kanban,
    actor: 'script_auto_seed_queue_task',
  });
  if (!productionWriteGuard.ok) {
    report.blockedSynthetic = true;
    report.blockCode = productionWriteGuard.code;
    report.error = productionWriteGuard.error;
  } else if (queueLight) {
    const syntheticGuard = evaluateSyntheticWriteGuard({
      mode: boardMode,
      name: args.title,
      description: defaultDescription,
      operation: 'script_auto_seed_queue_task',
      path: 'scripts/auto-seed-queue-task.js',
      source: 'auto-seed-queue-task',
      logger: console
    });

    if (!syntheticGuard.ok) {
      report.blockedSynthetic = true;
      report.blockCode = syntheticGuard.code;
    } else {
      const taskId = crypto.randomUUID();
      const card = {
        id: taskId,
        name: args.title,
        description: defaultDescription,
        priority: args.priority,
        status: 'todo',
        source: 'auto-seed-queue-task',
        createdAt: nowIso,
        updatedAt: nowIso,
        completedAt: null
      };

      board.columns.todo.unshift(card);
      board.activityLog.unshift({
        at: nowIso,
        type: 'task_created',
        taskId,
        taskName: card.name,
        detail: 'Auto-seeded because queue was empty.'
      });
      board.activityLog = board.activityLog.slice(0, 500);

      fs.writeFileSync(args.kanban, JSON.stringify(board, null, 2));

      report.seeded = true;
      report.taskId = taskId;
    }
  }

  if (args.reportOut) {
    fs.mkdirSync(path.dirname(args.reportOut), { recursive: true });
    fs.writeFileSync(args.reportOut, JSON.stringify(report, null, 2));
  }

  process.stdout.write(JSON.stringify(report, null, 2) + '\n');
}

if (require.main === module) {
  try {
    main();
  } catch (err) {
    console.error(`auto-seed-queue-task failed: ${err.message}`);
    process.exit(1);
  }
}
