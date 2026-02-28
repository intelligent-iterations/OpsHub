#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const SYNTHETIC_NAME_RE = /^(smoke task|lifecycle task|integration dashboard task)$/i;

function parseNonNegativeInteger(value, flagName) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || Number.isNaN(parsed) || parsed < 0) {
    throw new Error(`${flagName} requires a non-negative integer, received: ${value}`);
  }
  return parsed;
}

function parseArgs(argv) {
  const args = {
    kanban: path.resolve(__dirname, '..', 'data', 'kanban.json'),
    nowMs: Date.now(),
    apply: false,
    reportJsonOut: null
  };

  for (let i = 2; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === '--kanban') args.kanban = path.resolve(argv[++i]);
    else if (token === '--now-ms') args.nowMs = parseNonNegativeInteger(argv[++i], '--now-ms');
    else if (token === '--report-json-out') args.reportJsonOut = path.resolve(argv[++i]);
    else if (token === '--apply') args.apply = true;
    else if (token === '--help' || token === '-h') {
      printHelp();
      process.exit(0);
    } else throw new Error(`Unknown argument: ${token}`);
  }

  return args;
}

function printHelp() {
  console.log(`kanban-ttl-sweep\n\nUsage:\n  node scripts/kanban-ttl-sweep.js [options]\n\nOptions:\n  --kanban <path>           Path to kanban.json\n  --now-ms <epochMs>        Override current time for deterministic runs/tests\n  --report-json-out <path>  Write JSON report\n  --apply                   Persist TTL expirations to kanban\n  -h, --help                Show help`);
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

function isStrategicTask(task = {}) {
  return String(task?.source || '').trim().toLowerCase() === 'intelligent-iteration';
}

function isSyntheticTask(task = {}) {
  if (isStrategicTask(task)) return false;
  return SYNTHETIC_NAME_RE.test(String(task?.name || '').trim());
}

function resolveTtlMinutes(task = {}) {
  if (Number.isFinite(task?.ttlMinutes) && task.ttlMinutes >= 0) return task.ttlMinutes;
  return isSyntheticTask(task) ? 60 : null;
}

function resolveTaskAgeMinutes(task, nowMs) {
  const anchor = task.updatedAt || task.startedAt || task.createdAt;
  const ageMs = anchor ? nowMs - Date.parse(anchor) : Number.POSITIVE_INFINITY;
  return Number.isFinite(ageMs) ? ageMs / 60000 : Number.POSITIVE_INFINITY;
}

function sweepExpiredTasks(board, options = {}) {
  const nowMs = Number.isFinite(options.nowMs) ? options.nowMs : Date.now();
  const out = normalizeBoard(board);
  const expired = [];

  for (const col of ['todo', 'inProgress']) {
    const survivors = [];
    for (const task of out.columns[col]) {
      const ttlMinutes = resolveTtlMinutes(task);
      if (!Number.isFinite(ttlMinutes) || ttlMinutes === null || isStrategicTask(task)) {
        survivors.push(task);
        continue;
      }

      const ageMinutes = resolveTaskAgeMinutes(task, nowMs);
      if (ageMinutes <= ttlMinutes) {
        survivors.push(task);
        continue;
      }

      const expiredTask = {
        ...task,
        ttlMinutes,
        status: 'done',
        completedAt: new Date(nowMs).toISOString(),
        updatedAt: new Date(nowMs).toISOString(),
        expiryReason: 'expired-ttl'
      };
      out.columns.done.unshift(expiredTask);
      out.activityLog.unshift({
        at: new Date(nowMs).toISOString(),
        type: 'task_auto_expired',
        taskId: task.id,
        taskName: task.name,
        from: col,
        to: 'done',
        reason: 'expired-ttl',
        detail: `Task auto-expired by kanban-ttl-sweep (${ageMinutes.toFixed(2)}m > ${ttlMinutes}m).`
      });

      expired.push({
        taskId: task.id,
        taskName: task.name,
        from: col,
        ttlMinutes,
        ageMinutes: Number(ageMinutes.toFixed(2)),
        reason: 'expired-ttl'
      });
    }

    out.columns[col] = survivors;
  }

  out.activityLog = out.activityLog.slice(0, 500);

  return { board: out, expired };
}

function buildReport(args, expired) {
  return {
    generatedAt: new Date(args.nowMs).toISOString(),
    kanbanPath: args.kanban,
    applyMode: args.apply,
    expiredCount: expired.length,
    expired
  };
}

function main() {
  const args = parseArgs(process.argv);
  const board = normalizeBoard(JSON.parse(fs.readFileSync(args.kanban, 'utf8')));
  const { board: swept, expired } = sweepExpiredTasks(board, { nowMs: args.nowMs });
  const report = buildReport(args, expired);

  if (args.apply) {
    fs.writeFileSync(args.kanban, JSON.stringify(swept, null, 2), 'utf8');
  }

  if (args.reportJsonOut) {
    fs.mkdirSync(path.dirname(args.reportJsonOut), { recursive: true });
    fs.writeFileSync(args.reportJsonOut, JSON.stringify(report, null, 2), 'utf8');
  } else {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  }
}

module.exports = {
  parseArgs,
  normalizeBoard,
  isStrategicTask,
  isSyntheticTask,
  resolveTtlMinutes,
  sweepExpiredTasks,
  buildReport,
  main
};

if (require.main === module) {
  try {
    main();
  } catch (err) {
    console.error(`kanban-ttl-sweep failed: ${err.message}`);
    process.exit(1);
  }
}
