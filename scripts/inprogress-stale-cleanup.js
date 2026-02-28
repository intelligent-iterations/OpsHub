#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const util = require('util');
const { exec } = require('child_process');

const execAsync = util.promisify(exec);

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
    staleMinutes: 20,
    activeWindowMinutes: 3,
    reportJsonOut: null,
    reportMdOut: null,
    apply: false,
    taskIds: [],
    autoRecover: true,
    fallbackCount: 2
  };

  for (let i = 2; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === '--kanban') args.kanban = path.resolve(argv[++i]);
    else if (token === '--stale-minutes') args.staleMinutes = parseNonNegativeInteger(argv[++i], '--stale-minutes');
    else if (token === '--active-window-minutes') args.activeWindowMinutes = parseNonNegativeInteger(argv[++i], '--active-window-minutes');
    else if (token === '--report-json-out') args.reportJsonOut = path.resolve(argv[++i]);
    else if (token === '--report-md-out') args.reportMdOut = path.resolve(argv[++i]);
    else if (token === '--apply') args.apply = true;
    else if (token === '--task-id') args.taskIds.push(String(argv[++i] || '').trim());
    else if (token === '--no-auto-recover') args.autoRecover = false;
    else if (token === '--fallback-count') args.fallbackCount = parseNonNegativeInteger(argv[++i], '--fallback-count');
    else if (token === '--help' || token === '-h') {
      printHelp();
      process.exit(0);
    } else throw new Error(`Unknown argument: ${token}`);
  }

  args.taskIds = [...new Set(args.taskIds.filter(Boolean))];
  return args;
}

function printHelp() {
  console.log(`inprogress-stale-cleanup\n\nUsage:\n  node scripts/inprogress-stale-cleanup.js [options]\n\nOptions:\n  --kanban <path>                 Path to kanban.json\n  --stale-minutes <n>             Task age threshold in minutes (default: 20)\n  --active-window-minutes <n>     OpenClaw active session recency in minutes (default: 3)\n  --report-json-out <path>        Write JSON report\n  --report-md-out <path>          Write markdown report\n  --task-id <id>                  Restrict remediation/reporting to specific task id (repeatable)\n  --apply                         Move stale tasks from inProgress -> todo\n  --no-auto-recover               Disable autonomous self-recovery + fallback dispatch\n  --fallback-count <n>            Launch up to n fallback tasks per stalled worker (default: 2)\n  -h, --help                      Show help`);
}

function safeReadJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
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

function normalizeKey(value) {
  return String(value || '').trim().toLowerCase();
}

function collectTaskMatchKeys(task) {
  const direct = [task.id, task.subagentSessionId, task.subagentLabel, task.sessionId, task.subagent?.sessionId, task.subagent?.label];
  const text = `${task.name || ''}\n${task.description || ''}`;
  const fromText = [];
  for (const m of text.matchAll(/(?:label|subagent)\s*[:=]\s*([\w:-]{4,})/gi)) fromText.push(m[1]);
  for (const m of text.match(/agent:[\w:-]+/gi) || []) fromText.push(m);
  return [...new Set([...direct, ...fromText].map(normalizeKey).filter(Boolean))];
}

function collectActiveSessionKeys(sessions) {
  const keys = [];
  for (const s of sessions) keys.push(normalizeKey(s?.key), normalizeKey(s?.sessionId), normalizeKey(s?.label), normalizeKey(s?.name));
  return new Set(keys.filter(Boolean));
}

function isStallWaitingTask(task) {
  const text = `${task?.name || ''}\n${task?.description || ''}`;
  return /\b(waiting|stalled|blocked|awaiting instruction|no first action)\b/i.test(text);
}

function detectStaleInProgressTasks(board, options = {}) {
  const nowMs = Number.isFinite(options.nowMs) ? options.nowMs : Date.now();
  const staleMinutes = Number.isFinite(options.staleMinutes) ? options.staleMinutes : 20;
  const activeSessions = Array.isArray(options.activeSessions) ? options.activeSessions : [];
  const staleMs = staleMinutes * 60 * 1000;
  const activeSessionKeys = collectActiveSessionKeys(activeSessions);
  const tasks = Array.isArray(board?.columns?.inProgress) ? board.columns.inProgress : [];

  return tasks.map((task) => {
    const anchor = task.updatedAt || task.startedAt || task.createdAt;
    const ageMs = anchor ? nowMs - Date.parse(anchor) : Number.POSITIVE_INFINITY;
    const taskKeys = collectTaskMatchKeys(task);
    const matchedKeys = taskKeys.filter((k) => activeSessionKeys.has(k));
    const hasActiveMatch = matchedKeys.length > 0;
    const isStaleByAge = ageMs >= staleMs;
    const waitingSignal = isStallWaitingTask(task);
    const stale = !hasActiveMatch && isStaleByAge;
    const stalledWorker = stale || waitingSignal;

    const reasons = [];
    if (!hasActiveMatch) reasons.push('no-active-subagent-match');
    if (isStaleByAge) reasons.push('age-threshold-exceeded');
    if (waitingSignal) reasons.push('waiting-or-stalled-signal');

    return {
      taskId: task.id,
      taskName: task.name,
      source: task.source || null,
      ageMinutes: Number.isFinite(ageMs) ? Number((ageMs / 60000).toFixed(2)) : null,
      ageAnchor: anchor || null,
      matchedSessionKeys: matchedKeys,
      stale,
      stalledWorker,
      reasons
    };
  });
}

function makeFallbackTask(task, index) {
  return {
    id: `${task.id}-fallback-${index + 1}`,
    name: `[Fallback ${index + 1}] ${task.name}`,
    description: `Autonomous fallback dispatched for stalled task ${task.id}.`,
    priority: task.priority || 'high',
    status: 'todo',
    source: 'autonomous-recovery',
    createdAt: new Date().toISOString(),
    completedAt: null,
    metadata: {
      fallbackForTaskId: task.id,
      fallbackIndex: index + 1
    }
  };
}

function applyRemediation(board, detectionResults, options = {}) {
  const staleMinutes = Number.isFinite(options.staleMinutes) ? options.staleMinutes : 20;
  const autoRecover = options.autoRecover !== false;
  const fallbackCount = Math.min(Number.isFinite(options.fallbackCount) ? options.fallbackCount : 2, 2);

  const out = normalizeBoard(board);
  const staleById = new Map(detectionResults.filter((r) => r.stale).map((r) => [r.taskId, r]));
  const stalledById = new Map(detectionResults.filter((r) => r.stalledWorker).map((r) => [r.taskId, r]));

  const movedTaskIds = [];
  const selfRecoveryAttempts = [];
  const fallbackTaskIds = [];
  const keptInProgress = [];

  for (const task of out.columns.inProgress) {
    const stale = staleById.get(task.id);
    const stalled = stalledById.get(task.id);

    if (autoRecover && stalled) {
      out.activityLog.unshift({
        at: new Date().toISOString(),
        type: 'worker_self_recovery_attempt',
        taskId: task.id,
        taskName: task.name,
        detail: `Autonomous recovery attempted for stalled worker (${stalled.reasons.join(', ') || 'unknown'}).`
      });
      selfRecoveryAttempts.push(task.id);

      for (let i = 0; i < fallbackCount; i += 1) {
        const fallbackTask = makeFallbackTask(task, i);
        out.columns.todo.unshift(fallbackTask);
        fallbackTaskIds.push(fallbackTask.id);
      }
    }

    if (stale) {
      task.status = 'todo';
      task.updatedAt = new Date().toISOString();
      out.columns.todo.unshift(task);
      out.activityLog.unshift({
        at: new Date().toISOString(),
        type: 'task_reassigned',
        taskId: task.id,
        taskName: task.name,
        to: 'todo',
        detail: `Auto-remediated by inprogress-stale-cleanup (--stale-minutes=${staleMinutes}).`
      });
      movedTaskIds.push(task.id);
    } else keptInProgress.push(task);
  }

  out.columns.inProgress = keptInProgress;
  out.activityLog = out.activityLog.slice(0, 500);

  return { board: out, movedTaskIds, selfRecoveryAttempts, fallbackTaskIds };
}

async function fetchActiveSubagentSessions(activeWindowMinutes) {
  const command = `~/.openclaw/bin/openclaw sessions --active ${activeWindowMinutes} --json`;
  try {
    const { stdout } = await execAsync(command, { timeout: 5000, maxBuffer: 1024 * 1024 });
    const parsed = JSON.parse(stdout || '{}');
    const sessions = Array.isArray(parsed?.sessions) ? parsed.sessions : [];
    return sessions.filter((s) => typeof s?.key === 'string' && s.key.includes(':subagent:'));
  } catch {
    return [];
  }
}

function inferLikelyRootCauses(results) {
  const stale = results.filter((r) => r.stale);
  const waiting = results.filter((r) => r.stalledWorker && r.reasons.includes('waiting-or-stalled-signal'));
  return {
    staleCount: stale.length,
    waitingSignalCount: waiting.length,
    likelyCause:
      stale.length > 0
        ? 'Workers appear stalled or detached from active sessions; autonomous recovery + fallback dispatch is recommended.'
        : 'No systemic stall pattern detected.'
  };
}

function toMarkdown(report) {
  const lines = [];
  lines.push('# In-Progress Stale Task Cleanup Report');
  lines.push('');
  lines.push(`Generated: ${report.generatedAt}`);
  lines.push(`Mode: ${report.applyMode ? 'apply' : 'dry-run'}`);
  lines.push(`Auto recover: ${report.autoRecover ? 'enabled' : 'disabled'}`);
  lines.push(`Fallback count: ${report.fallbackCount}`);
  lines.push('');
  lines.push('## Summary');
  lines.push(`- In Progress tasks inspected: **${report.summary.inProgressChecked}**`);
  lines.push(`- Stale candidates: **${report.summary.staleCandidates}**`);
  lines.push(`- Stalled/waiting workers: **${report.summary.stalledWorkers}**`);
  lines.push(`- Reassigned to To Do: **${report.summary.reassignedCount}**`);
  lines.push(`- Self-recovery attempts: **${report.summary.selfRecoveryAttempts}**`);
  lines.push(`- Fallback tasks dispatched: **${report.summary.fallbackTasksDispatched}**`);
  lines.push('');
  return lines.join('\n');
}

async function main() {
  const args = parseArgs(process.argv);
  const original = normalizeBoard(safeReadJson(args.kanban));
  const activeSessions = await fetchActiveSubagentSessions(args.activeWindowMinutes);
  const inspected = detectStaleInProgressTasks(original, {
    staleMinutes: args.staleMinutes,
    activeSessions
  });

  const scopedTaskIds = new Set(args.taskIds.map(normalizeKey));
  const scopedInspected = scopedTaskIds.size
    ? inspected.map((item) => (scopedTaskIds.has(normalizeKey(item.taskId)) ? item : { ...item, stale: false, stalledWorker: false }))
    : inspected;

  let movedTaskIds = [];
  let selfRecoveryAttempts = [];
  let fallbackTaskIds = [];
  if (args.apply) {
    const applied = applyRemediation(original, scopedInspected, {
      staleMinutes: args.staleMinutes,
      autoRecover: args.autoRecover,
      fallbackCount: args.fallbackCount
    });
    movedTaskIds = applied.movedTaskIds;
    selfRecoveryAttempts = applied.selfRecoveryAttempts;
    fallbackTaskIds = applied.fallbackTaskIds;
    fs.writeFileSync(args.kanban, JSON.stringify(applied.board, null, 2), 'utf8');
  }

  const report = {
    generatedAt: new Date().toISOString(),
    applyMode: args.apply,
    autoRecover: args.autoRecover,
    fallbackCount: args.fallbackCount,
    kanbanPath: args.kanban,
    summary: {
      inProgressChecked: inspected.length,
      staleCandidates: scopedInspected.filter((r) => r.stale).length,
      stalledWorkers: scopedInspected.filter((r) => r.stalledWorker).length,
      reassignedCount: movedTaskIds.length,
      selfRecoveryAttempts: selfRecoveryAttempts.length,
      fallbackTasksDispatched: fallbackTaskIds.length
    },
    rootCause: inferLikelyRootCauses(scopedInspected),
    staleCandidates: scopedInspected.filter((r) => r.stale),
    stalledWorkers: scopedInspected.filter((r) => r.stalledWorker),
    movedTaskIds,
    selfRecoveryAttempts,
    fallbackTaskIds
  };

  const markdown = toMarkdown(report);
  if (args.reportJsonOut) {
    fs.mkdirSync(path.dirname(args.reportJsonOut), { recursive: true });
    fs.writeFileSync(args.reportJsonOut, JSON.stringify(report, null, 2), 'utf8');
  } else process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);

  if (args.reportMdOut) {
    fs.mkdirSync(path.dirname(args.reportMdOut), { recursive: true });
    fs.writeFileSync(args.reportMdOut, markdown, 'utf8');
  } else process.stdout.write(`\n${markdown}\n`);
}

module.exports = {
  parseArgs,
  detectStaleInProgressTasks,
  applyRemediation,
  inferLikelyRootCauses,
  toMarkdown,
  main
};

if (require.main === module) {
  main().catch((err) => {
    console.error(`inprogress-stale-cleanup failed: ${err.message}`);
    process.exit(1);
  });
}
