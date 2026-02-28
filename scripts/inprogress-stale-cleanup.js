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
    taskIds: []
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
    else if (token === '--help' || token === '-h') {
      printHelp();
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${token}`);
    }
  }

  args.taskIds = uniq(args.taskIds.map((id) => id.trim())).filter(Boolean);
  return args;
}

function printHelp() {
  console.log(`inprogress-stale-cleanup\n\nUsage:\n  node scripts/inprogress-stale-cleanup.js [options]\n\nOptions:\n  --kanban <path>                 Path to kanban.json (default: OpsHub/data/kanban.json)\n  --stale-minutes <n>             Task age threshold in minutes (default: 20)\n  --active-window-minutes <n>     OpenClaw active session recency in minutes (default: 3)\n  --report-json-out <path>        Write JSON report\n  --report-md-out <path>          Write markdown report\n  --task-id <id>                  Restrict remediation/reporting to specific task id (repeatable)\n  --apply                         Move stale tasks from inProgress -> todo + add activityLog entries\n  -h, --help                      Show help\n\nBy default this script is dry-run only.`);
}

function safeReadJson(filePath) {
  const raw = fs.readFileSync(filePath, 'utf8');
  return JSON.parse(raw);
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

function uniq(list) {
  return [...new Set(list.filter(Boolean))];
}

function normalizeKey(value) {
  return String(value || '').trim().toLowerCase();
}

function collectTaskMatchKeys(task) {
  const direct = [
    task.id,
    task.subagentSessionId,
    task.subagentLabel,
    task.sessionId,
    task.agentSession,
    task.subagent?.sessionId,
    task.subagent?.label
  ];

  const fromText = [];
  const text = `${task.name || ''}\n${task.description || ''}`;
  const labelMatches = [...text.matchAll(/(?:label|subagent)\s*[:=]\s*([\w:-]{4,})/gi)];
  const sessionMatches = text.match(/agent:[\w:-]+/gi) || [];
  fromText.push(...labelMatches.map((m) => m[1]));
  fromText.push(...sessionMatches);

  return uniq([...direct, ...fromText].map(normalizeKey));
}

function collectActiveSessionKeys(sessions) {
  const keys = [];
  for (const s of sessions) {
    keys.push(normalizeKey(s?.key));
    keys.push(normalizeKey(s?.sessionId));
    keys.push(normalizeKey(s?.label));
    keys.push(normalizeKey(s?.name));
  }
  return new Set(uniq(keys));
}

function detectStaleInProgressTasks(board, options = {}) {
  const nowMs = Number.isFinite(options.nowMs) ? options.nowMs : Date.now();
  const staleMinutes = Number.isFinite(options.staleMinutes) ? options.staleMinutes : 20;
  const activeSessions = Array.isArray(options.activeSessions) ? options.activeSessions : [];

  const staleMs = staleMinutes * 60 * 1000;
  const activeSessionKeys = collectActiveSessionKeys(activeSessions);
  const tasks = Array.isArray(board?.columns?.inProgress) ? board.columns.inProgress : [];

  const results = [];
  for (const task of tasks) {
    const anchor = task.updatedAt || task.startedAt || task.createdAt;
    const ageMs = anchor ? nowMs - Date.parse(anchor) : Number.POSITIVE_INFINITY;
    const taskKeys = collectTaskMatchKeys(task);
    const matchedKeys = taskKeys.filter((k) => activeSessionKeys.has(k));

    const hasActiveMatch = matchedKeys.length > 0;
    const isStaleByAge = ageMs >= staleMs;

    const reasons = [];
    if (!hasActiveMatch) reasons.push('no-active-subagent-match');
    if (isStaleByAge) reasons.push('age-threshold-exceeded');

    results.push({
      taskId: task.id,
      taskName: task.name,
      source: task.source || null,
      ageMinutes: Number.isFinite(ageMs) ? Number((ageMs / 60000).toFixed(2)) : null,
      ageAnchor: anchor || null,
      matchedSessionKeys: matchedKeys,
      taskMatchKeys: taskKeys,
      stale: !hasActiveMatch && isStaleByAge,
      reasons
    });
  }

  return results;
}

function remediationEntry(task, staleMinutes) {
  return {
    type: 'task_reassigned',
    taskId: task.id,
    taskName: task.name,
    to: 'todo',
    detail: `Auto-remediated by inprogress-stale-cleanup (--stale-minutes=${staleMinutes}): no active sub-agent match + stale age threshold exceeded.`
  };
}

function applyRemediation(board, staleResults, options = {}) {
  const staleMinutes = Number.isFinite(options.staleMinutes) ? options.staleMinutes : 20;
  const out = normalizeBoard(board);
  const staleById = new Map(staleResults.filter((r) => r.stale).map((r) => [r.taskId, r]));

  const moved = [];
  const keptInProgress = [];

  for (const task of out.columns.inProgress) {
    if (staleById.has(task.id)) {
      task.status = 'todo';
      task.updatedAt = new Date().toISOString();
      out.columns.todo.unshift(task);
      out.activityLog.unshift({ at: new Date().toISOString(), ...remediationEntry(task, staleMinutes) });
      moved.push(task.id);
    } else {
      keptInProgress.push(task);
    }
  }

  out.columns.inProgress = keptInProgress;
  out.activityLog = out.activityLog.slice(0, 500);

  return {
    board: out,
    movedTaskIds: moved
  };
}

async function fetchActiveSubagentSessions(activeWindowMinutes) {
  const command = `~/.openclaw/bin/openclaw sessions --active ${activeWindowMinutes} --json`;
  try {
    const { stdout } = await execAsync(command, {
      timeout: 5000,
      maxBuffer: 1024 * 1024
    });

    const parsed = JSON.parse(stdout || '{}');
    const sessions = Array.isArray(parsed?.sessions) ? parsed.sessions : [];
    return sessions.filter((s) => typeof s?.key === 'string' && s.key.includes(':subagent:'));
  } catch {
    return [];
  }
}

function inferLikelyRootCauses(staleResults) {
  const stale = staleResults.filter((r) => r.stale);
  const genericIntegrationTasks = stale.filter((r) => /integration dashboard task/i.test(r.taskName || ''));
  const manualSource = stale.filter((r) => (r.source || '').toLowerCase() === 'manual');
  return {
    staleCount: stale.length,
    genericIntegrationTaskCount: genericIntegrationTasks.length,
    manualSourceCount: manualSource.length,
    likelyCause:
      stale.length > 0 && genericIntegrationTasks.length === stale.length
        ? 'In-progress cards were created manually as generic placeholders without sub-agent session/label linkage, so they cannot be reconciled against active sub-agents.'
        : 'Some in-progress cards do not carry session/label linkage and exceed stale threshold with no active sub-agent match.'
  };
}

function toMarkdown(report) {
  const lines = [];
  lines.push('# In-Progress Stale Task Cleanup Report');
  lines.push('');
  lines.push(`Generated: ${report.generatedAt}`);
  lines.push(`Mode: ${report.applyMode ? 'apply' : 'dry-run'}`);
  lines.push(`Kanban: ${report.kanbanPath}`);
  if (Array.isArray(report.scopedTaskIds) && report.scopedTaskIds.length > 0) {
    lines.push(`Task scope: ${report.scopedTaskIds.map((id) => `\`${id}\``).join(', ')}`);
  }
  lines.push('');
  lines.push('## Summary');
  lines.push('');
  lines.push(`- In Progress tasks inspected: **${report.summary.inProgressChecked}**`);
  lines.push(`- Active sub-agent sessions: **${report.summary.activeSubagents}**`);
  lines.push(`- Stale candidates: **${report.summary.staleCandidates}**`);
  lines.push(`- Reassigned to To Do: **${report.summary.reassignedCount}**`);
  lines.push('');
  lines.push('## Likely Root Cause');
  lines.push('');
  lines.push(`- ${report.rootCause.likelyCause}`);
  lines.push('');

  if (report.staleCandidates.length === 0) {
    lines.push('_No stale in-progress tasks detected._');
    return lines.join('\n');
  }

  lines.push('## Stale Candidates');
  lines.push('');
  for (const item of report.staleCandidates) {
    lines.push(`- **${item.taskName}** (\`${item.taskId}\`)`);
    lines.push(`  - ageMinutes: ${item.ageMinutes}`);
    lines.push(`  - source: ${item.source || 'unknown'}`);
    lines.push(`  - reasons: ${item.reasons.join(', ')}`);
  }
  return lines.join('\n');
}

function writeJson(filePath, obj) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(obj, null, 2), 'utf8');
}

function writeText(filePath, text) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, text, 'utf8');
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
  const scopedInspected =
    scopedTaskIds.size === 0
      ? inspected
      : inspected.map((item) => {
          if (scopedTaskIds.has(normalizeKey(item.taskId))) return item;
          return { ...item, stale: false };
        });

  let updatedBoard = original;
  let movedTaskIds = [];
  if (args.apply) {
    const applied = applyRemediation(original, scopedInspected, { staleMinutes: args.staleMinutes });
    updatedBoard = applied.board;
    movedTaskIds = applied.movedTaskIds;
    fs.writeFileSync(args.kanban, JSON.stringify(updatedBoard, null, 2), 'utf8');
  }

  const staleCandidates = scopedInspected.filter((r) => r.stale);
  const report = {
    generatedAt: new Date().toISOString(),
    applyMode: args.apply,
    kanbanPath: args.kanban,
    thresholds: {
      staleMinutes: args.staleMinutes,
      activeWindowMinutes: args.activeWindowMinutes
    },
    summary: {
      inProgressChecked: inspected.length,
      activeSubagents: activeSessions.length,
      staleCandidates: staleCandidates.length,
      reassignedCount: movedTaskIds.length
    },
    rootCause: inferLikelyRootCauses(scopedInspected),
    scopedTaskIds: args.taskIds,
    staleCandidates,
    movedTaskIds
  };

  const markdown = toMarkdown(report);

  if (args.reportJsonOut) writeJson(args.reportJsonOut, report);
  if (args.reportMdOut) writeText(args.reportMdOut, markdown);

  if (!args.reportJsonOut) process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  if (!args.reportMdOut) process.stdout.write(`\n${markdown}\n`);
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
