const express = require('express');
const fs = require('fs/promises');
const path = require('path');
const { exec } = require('child_process');
const util = require('util');
const crypto = require('crypto');
const { computePantryPalWipMetrics, computeStrategicQueueMetrics, prioritizeWithGuardrails } = require('./scripts/pantrypal-priority-guardrails');
const {
  computeManagerLoopMetrics,
  evaluateManagerLoopThresholds,
  applyAutoNextActionScheduler
} = require('./scripts/manager-loop-guardrails');
const { validateHumanFacingUpdate } = require('./lib/human-deliverable-guard');
const { evaluateBlockerProtocol, captureBlockerProofArtifact } = require('./lib/blocker-protocol');
const { buildLiveAgentActivity } = require('./lib/openclaw-live-activity');

const execAsync = util.promisify(exec);
const PORT = Number(process.env.PORT) || 4180;
const WORKSPACE = path.resolve(__dirname, '..');
const MEMORY_DIR = path.join(WORKSPACE, 'memory');
const OPSHUB_DIR = __dirname;
function getDataDir() {
  return process.env.OPSHUB_DATA_DIR ? path.resolve(process.env.OPSHUB_DATA_DIR) : path.join(OPSHUB_DIR, 'data');
}

function getKanbanPath() {
  return path.join(getDataDir(), 'kanban.json');
}

const BLOCKER_PROOF_DIR = path.join(OPSHUB_DIR, 'artifacts', 'blocker-proofs');

const VALID_COLUMNS = ['backlog', 'todo', 'inProgress', 'done'];
const ACTIVE_COLUMNS = ['backlog', 'todo', 'inProgress'];
const VALID_PRIORITIES = ['critical', 'high', 'medium', 'low'];
const BOARD_MODE = String(process.env.OPSHUB_BOARD_MODE || 'production').toLowerCase() === 'diagnostic' ? 'diagnostic' : 'production';
const IN_PROGRESS_WIP_LIMIT = Number(process.env.OPSHUB_INPROGRESS_WIP_LIMIT || 5);
const IN_PROGRESS_WIP_LIMIT_BY_PRIORITY = {
  high: Number(process.env.OPSHUB_INPROGRESS_WIP_LIMIT_HIGH || IN_PROGRESS_WIP_LIMIT),
  medium: Number(process.env.OPSHUB_INPROGRESS_WIP_LIMIT_MEDIUM || IN_PROGRESS_WIP_LIMIT),
  low: Number(process.env.OPSHUB_INPROGRESS_WIP_LIMIT_LOW || IN_PROGRESS_WIP_LIMIT)
};

function nowIso() {
  return new Date().toISOString();
}

function didCorrectionOccur(task, payload = {}) {
  return Boolean(
    payload.correctionOccurred ||
      task?.correctionOccurred ||
      task?.correctionRequired ||
      task?.metadata?.correctionOccurred ||
      task?.metadata?.correctionRequired ||
      (Number(task?.metadata?.correctionCount) || 0) > 0
  );
}

function hasCorrectionLogRecord(task, payload = {}) {
  const inbound = payload.correctionLog || payload?.metadata?.correctionLog;
  return Boolean(inbound || task?.correctionLog || task?.metadata?.correctionLog);
}

function getVerificationRecord(task, payload = {}) {
  const inbound = payload.verification || payload?.metadata?.verification;
  if (inbound && typeof inbound === 'object') return inbound;
  if (task?.verification && typeof task.verification === 'object') return task.verification;
  if (task?.metadata?.verification && typeof task.metadata.verification === 'object') return task.metadata.verification;
  return null;
}

function hasRequiredDoneVerification(task, payload = {}) {
  const verification = getVerificationRecord(task, payload);
  if (!verification) return false;
  const command = cleanText(verification.command, 300);
  const result = cleanText(verification.result, 20).toLowerCase();
  const verifiedAt = cleanText(verification.verifiedAt || payload.verifiedAt || task?.verifiedAt, 100);
  return Boolean(command && verifiedAt && result === 'pass' && !Number.isNaN(new Date(verifiedAt).getTime()));
}

function normalizeForDuplicate(value = '') {
  return cleanText(value, 2000).toLowerCase().replace(/\s+/g, ' ').trim();
}

function isPlaceholderDescription(description = '') {
  const normalized = normalizeForDuplicate(description);
  if (!normalized) return true;
  return /^(tbd|todo|placeholder|n\/?a|none|lorem ipsum|coming soon|test|temp|wip|pending)\.?$/.test(normalized);
}

function isDeniedSyntheticPattern(name = '', description = '') {
  const loweredName = normalizeForDuplicate(name);
  const loweredDesc = normalizeForDuplicate(description);
  return /(smoke task|lifecycle task|integration dashboard task|closeout reminder|placeholder)/.test(`${loweredName} ${loweredDesc}`);
}

function hasAcceptanceCriteria(description = '') {
  const normalized = cleanText(description, 4000).toLowerCase();
  return /acceptance criteria|\n\s*[-*]\s+/.test(normalized);
}

function findDuplicateActiveTask(board, { name, description, excludingTaskId = null }) {
  const keyName = normalizeForDuplicate(name);
  const keyDesc = normalizeForDuplicate(description);
  for (const col of ACTIVE_COLUMNS) {
    for (const task of board.columns[col] || []) {
      if (excludingTaskId && task.id === excludingTaskId) continue;
      const sameName = normalizeForDuplicate(task.name) === keyName;
      const sameDescription = normalizeForDuplicate(task.description) === keyDesc;
      if (sameName && sameDescription) return task;
    }
  }
  return null;
}

function validateTaskAdmission({ board, name, description, source, targetColumn = 'backlog', mode = BOARD_MODE, excludingTaskId = null }) {
  const cleanedSource = cleanText(source, 100).toLowerCase();

  if (mode === 'production' && isDeniedSyntheticPattern(name, description)) {
    return {
      ok: false,
      status: 422,
      error: 'task admission denied in production mode for synthetic/placeholder pattern',
      code: 'TASK_ADMISSION_SYNTHETIC_DENIED'
    };
  }

  if (targetColumn === 'inProgress' && isPlaceholderDescription(description)) {
    const allowManual = cleanedSource === 'manual' || cleanedSource === 'ui';
    const allowIntelligentIteration = cleanedSource === 'intelligent-iteration' && hasAcceptanceCriteria(description);
    if (!allowManual && !allowIntelligentIteration) {
      return {
        ok: false,
        status: 422,
        error: 'task admission requires substantive description (placeholder content denied)',
        code: 'TASK_ADMISSION_PLACEHOLDER_DESCRIPTION'
      };
    }
  }

  const duplicate = findDuplicateActiveTask(board, { name, description, excludingTaskId });
  if (duplicate) {
    return {
      ok: false,
      status: 409,
      error: 'task admission denied: duplicate active task',
      code: 'TASK_ADMISSION_DUPLICATE_ACTIVE',
      duplicateTaskId: duplicate.id
    };
  }

  return { ok: true };
}

function enforceInProgressWipLimit(board, taskPriority = 'medium') {
  const currentInProgress = Array.isArray(board?.columns?.inProgress) ? board.columns.inProgress : [];
  const normalizedPriority = VALID_PRIORITIES.includes(taskPriority) ? taskPriority : 'medium';
  if (normalizedPriority === 'critical') return { ok: true };

  const globalLimitHit = Number.isFinite(IN_PROGRESS_WIP_LIMIT) && IN_PROGRESS_WIP_LIMIT > 0 && currentInProgress.length >= IN_PROGRESS_WIP_LIMIT;
  const priorityLimit = IN_PROGRESS_WIP_LIMIT_BY_PRIORITY[normalizedPriority];
  const samePriorityCount = currentInProgress.filter((task) => (VALID_PRIORITIES.includes(task?.priority) ? task.priority : 'medium') === normalizedPriority).length;
  const priorityLimitHit = Number.isFinite(priorityLimit) && priorityLimit > 0 && samePriorityCount >= priorityLimit;

  if (!globalLimitHit && !priorityLimitHit) return { ok: true };
  return {
    ok: false,
    status: 422,
    error: 'inProgress WIP limit exceeded',
    code: 'WIP_LIMIT_EXCEEDED',
    limits: {
      global: { limit: IN_PROGRESS_WIP_LIMIT, current: currentInProgress.length },
      byPriority: { priority: normalizedPriority, limit: priorityLimit, current: samePriorityCount }
    }
  };
}

function requiresDelegationTrigger(task = {}) {
  const name = cleanText(task?.name || '', 400).toLowerCase();
  const description = cleanText(task?.description || '', 4000);
  const lowered = description.toLowerCase();
  const bulletCount = (description.match(/\n\s*[-*]/g) || []).length;
  const keywordHit = /(acceptance criteria|multi-step|cross-team|integration|kpi report|simulation fixture|recompute|delegate)/.test(`${name} ${lowered}`);
  return keywordHit || description.length >= 280 || bulletCount >= 3;
}

function upsertCloseoutReminder(board, task, issues = []) {
  const detail = `Closeout contract reminder: ${issues.length ? issues.join('; ') : 'missing GitHub evidence and/or verification.'}`;
  pushActivity(board, {
    type: 'closeout_contract_reminder',
    taskId: task.id,
    taskName: task.name,
    to: task.status || 'inProgress',
    detail
  });
}
function cleanText(value, maxLen = 3000) {
  const str = String(value ?? '')
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .trim();
  return str.length > maxLen ? str.slice(0, maxLen) : str;
}

async function ensureDataDir() {
  await fs.mkdir(getDataDir(), { recursive: true });
}

function defaultKanban() {
  return {
    columns: {
      backlog: [],
      todo: [],
      inProgress: [],
      done: []
    },
    activityLog: []
  };
}

function isSyntheticTtlCandidate(taskLike = {}) {
  const name = cleanText(taskLike?.name || '', 200).toLowerCase();
  const source = cleanText(taskLike?.source || '', 100).toLowerCase();
  if (source === 'intelligent-iteration') return false;
  return /^(smoke task|lifecycle task|integration dashboard task)$/.test(name);
}

function inferDefaultTtlMinutes(taskLike = {}) {
  return isSyntheticTtlCandidate(taskLike) ? 60 : null;
}

function newTask({ name, description = '', priority = 'medium', source = 'manual' }) {
  const cleanedName = cleanText(name, 200);
  const cleanedSource = cleanText(source, 100) || 'manual';
  return {
    id: crypto.randomUUID(),
    name: cleanedName,
    description: cleanText(description, 2000),
    priority: VALID_PRIORITIES.includes(priority) ? priority : 'medium',
    status: 'backlog',
    createdAt: nowIso(),
    completedAt: null,
    source: cleanedSource,
    ttlMinutes: inferDefaultTtlMinutes({ name: cleanedName, source: cleanedSource })
  };
}

function normalizeBoard(parsed) {
  return {
    columns: {
      backlog: Array.isArray(parsed?.columns?.backlog) ? parsed.columns.backlog : [],
      todo: Array.isArray(parsed?.columns?.todo) ? parsed.columns.todo : [],
      inProgress: Array.isArray(parsed?.columns?.inProgress) ? parsed.columns.inProgress : [],
      done: Array.isArray(parsed?.columns?.done) ? parsed.columns.done : []
    },
    activityLog: Array.isArray(parsed?.activityLog) ? parsed.activityLog : []
  };
}

async function loadKanban() {
  await ensureDataDir();
  try {
    const content = await fs.readFile(getKanbanPath(), 'utf8');
    return normalizeBoard(JSON.parse(content));
  } catch {
    const initial = defaultKanban();
    await saveKanban(initial);
    return initial;
  }
}

async function saveKanban(board) {
  await ensureDataDir();
  const kanbanPath = getKanbanPath();
  const tmpPath = `${kanbanPath}.${process.pid}.${crypto.randomUUID()}.tmp`;
  await fs.writeFile(tmpPath, JSON.stringify(board, null, 2), 'utf8');
  await fs.rename(tmpPath, kanbanPath);
}

function pushActivity(board, entry) {
  board.activityLog.unshift({ at: nowIso(), ...entry });
  board.activityLog = board.activityLog.slice(0, 500);
}

function findTask(board, taskId) {
  for (const col of VALID_COLUMNS) {
    const idx = board.columns[col].findIndex((t) => t.id === taskId);
    if (idx > -1) return { col, idx, task: board.columns[col][idx] };
  }
  return null;
}

async function readIfExists(filePath) {
  try {
    return await fs.readFile(filePath, 'utf8');
  } catch {
    return null;
  }
}

async function safeExec(command, cwd = WORKSPACE) {
  try {
    const { stdout, stderr } = await execAsync(command, { cwd, timeout: 4000, maxBuffer: 1024 * 1024 });
    return { ok: true, stdout, stderr: stderr || null };
  } catch (err) {
    return {
      ok: false,
      stdout: err.stdout || '',
      stderr: err.stderr || err.message,
      reason: 'Command unavailable or execution failed'
    };
  }
}

function parseJsonArray(stdout, key) {
  if (!stdout || !stdout.trim()) return [];
  try {
    const parsed = JSON.parse(stdout);
    const entries = Array.isArray(parsed?.[key]) ? parsed[key] : [];
    return entries;
  } catch {
    return [];
  }
}

async function runFirstOk(commands = []) {
  for (const command of commands) {
    const result = await safeExec(command);
    if (result.ok) return { ...result, command };
  }
  return { ok: false, stdout: '', stderr: 'No command succeeded', command: null };
}

async function getOpenClawTelemetry() {
  const sessionsResult = await runFirstOk([
    '~/.openclaw/bin/openclaw sessions --active 30 --json',
    'openclaw sessions --active 30 --json'
  ]);
  const runsResult = await runFirstOk([
    '~/.openclaw/bin/openclaw runs --active --json',
    'openclaw runs --active --json'
  ]);

  return {
    sessions: parseJsonArray(sessionsResult.stdout, 'sessions'),
    runs: parseJsonArray(runsResult.stdout, 'runs'),
    diagnostics: {
      sessionsSource: sessionsResult.command,
      runsSource: runsResult.command,
      sessionsCommandOk: Boolean(sessionsResult.ok),
      runsCommandOk: Boolean(runsResult.ok)
    }
  };
}

function normalizeInProgressTask(task, index) {
  const rawId = cleanText(task?.id, 200);
  const hasStableId = Boolean(rawId);
  return {
    id: hasStableId ? rawId : `kanban-inprogress-${index}`,
    task: cleanText(task?.name, 200) || '(untitled task)',
    description: cleanText(task?.description, 2000),
    priority: VALID_PRIORITIES.includes(task?.priority) ? task.priority : 'medium',
    status: 'In Progress',
    source: 'OpsHub kanban',
    _kanbanId: hasStableId ? rawId : null
  };
}

function buildInProgressSyncDiagnostics(rawInProgress, inProgressTasks) {
  const kanbanIds = rawInProgress.map((t) => cleanText(t?.id, 200)).filter(Boolean);
  const payloadIds = inProgressTasks.map((t) => t._kanbanId).filter(Boolean);

  const missingFromPayload = kanbanIds.filter((id) => !payloadIds.includes(id));
  const extrasInPayload = payloadIds.filter((id) => !kanbanIds.includes(id));
  const tasksMissingStableId = inProgressTasks
    .filter((t) => !t._kanbanId)
    .map((t) => ({ id: t.id, task: t.task }));

  const duplicatePayloadIds = payloadIds.filter((id, i) => payloadIds.indexOf(id) !== i);

  return {
    syncOk:
      missingFromPayload.length === 0 &&
      extrasInPayload.length === 0 &&
      duplicatePayloadIds.length === 0 &&
      tasksMissingStableId.length === 0,
    kanbanInProgressCount: rawInProgress.length,
    payloadInProgressCount: inProgressTasks.length,
    missingFromPayload,
    extrasInPayload,
    duplicatePayloadIds: [...new Set(duplicatePayloadIds)],
    tasksMissingStableId
  };
}

function buildBehaviorSignal(entry = {}) {
  const text = cleanText(`${entry?.type || ''} ${entry?.detail || ''} ${entry?.taskName || ''} ${entry?.summary || ''}`, 500).toLowerCase();
  const toState = cleanText(entry?.to || '', 30).toLowerCase();

  const proactive =
    /delegate|delegated|dispatch|dispatched|verify|verified|close|closed|implement|implemented/.test(text) ||
    (entry?.type === 'task_moved' && (toState === 'inprogress' || toState === 'done'));
  const passive = /wait|waiting|idle|no-action|stale/.test(text);
  const blocker = /blocker|escalat|permission|auth|secret|sudo|access denied/.test(text);
  const blockerCompliant = blocker && /attempt\s*2|two-attempt|proof|artifact|verification/.test(text);

  return { proactive, passive, blocker, blockerCompliant };
}

function summarizeBehaviorSignals(entries = [], thresholds = { passiveWaitRatio: 0.15, blockerProtocolCompliance: 0.95 }) {
  const signals = entries.map(buildBehaviorSignal);
  const proactiveSignals = signals.filter((s) => s.proactive).length;
  const passiveSignals = signals.filter((s) => s.passive).length;
  const totalSignals = proactiveSignals + passiveSignals;
  const totalBlockerEvents = signals.filter((s) => s.blocker).length;
  const compliantBlockerEvents = signals.filter((s) => s.blockerCompliant).length;

  const passiveWaitRatio = totalSignals > 0 ? Number((passiveSignals / totalSignals).toFixed(4)) : 0;
  const blockerProtocolCompliance = totalBlockerEvents > 0 ? Number((compliantBlockerEvents / totalBlockerEvents).toFixed(4)) : 1;

  return {
    proactiveSignals,
    passiveSignals,
    totalSignals,
    passiveWaitRatio,
    blockerProtocolCompliance,
    totalBlockerEvents,
    compliantBlockerEvents,
    passiveThresholdMet: passiveWaitRatio <= thresholds.passiveWaitRatio,
    blockerThresholdMet: blockerProtocolCompliance >= thresholds.blockerProtocolCompliance
  };
}

function computeBehaviorGapMetrics(board, thresholds = { passiveWaitRatio: 0.15, blockerProtocolCompliance: 0.95 }) {
  const entries = Array.isArray(board?.activityLog) ? [...board.activityLog].reverse() : [];
  const midpoint = Math.ceil(entries.length / 2);
  const beforeEntries = entries.slice(0, midpoint);
  const afterEntries = entries.slice(midpoint);

  const overall = summarizeBehaviorSignals(entries, thresholds);
  const before = summarizeBehaviorSignals(beforeEntries, thresholds);
  const after = summarizeBehaviorSignals(afterEntries, thresholds);

  return {
    proactiveLoop: {
      proactiveSignals: overall.proactiveSignals,
      passiveSignals: overall.passiveSignals,
      totalSignals: overall.totalSignals,
      passiveWaitRatio: overall.passiveWaitRatio,
      threshold: thresholds.passiveWaitRatio,
      thresholdMet: overall.passiveThresholdMet
    },
    blockerCompliance: {
      totalBlockerEvents: overall.totalBlockerEvents,
      compliantBlockerEvents: overall.compliantBlockerEvents,
      blockerProtocolCompliance: overall.blockerProtocolCompliance,
      threshold: thresholds.blockerProtocolCompliance,
      thresholdMet: overall.blockerThresholdMet
    },
    beforeAfter: {
      before: {
        passiveWaitRatio: before.passiveWaitRatio,
        blockerProtocolCompliance: before.blockerProtocolCompliance
      },
      after: {
        passiveWaitRatio: after.passiveWaitRatio,
        blockerProtocolCompliance: after.blockerProtocolCompliance
      },
      passiveWaitRatioReduction: Number((before.passiveWaitRatio - after.passiveWaitRatio).toFixed(4)),
      blockerProtocolComplianceLift: Number((after.blockerProtocolCompliance - before.blockerProtocolCompliance).toFixed(4))
    }
  };
}

async function getSubagentsData() {
  let board = await loadKanban();
  const scheduleResult = applyAutoNextActionScheduler(board, { staleMinutes: 20 });
  if (scheduleResult.changed) {
    board = scheduleResult.board;
    await saveKanban(board);
  }

  // 1) Ground truth for current tasks = kanban In Progress
  const rawInProgress = Array.isArray(board?.columns?.inProgress) ? board.columns.inProgress : [];
  const inProgressTasks = rawInProgress.map((t, idx) => normalizeInProgressTask(t, idx));

  // 2) Runtime sub-agent sessions from OpenClaw session store (recently active only)
  const telemetry = await getOpenClawTelemetry();
  const sessions = Array.isArray(telemetry.sessions) ? telemetry.sessions : [];
  const activeSubagents = sessions
    .filter((s) => typeof s?.key === 'string' && s.key.includes(':subagent:'))
    .filter((s) => Number(s?.ageMs ?? Number.MAX_SAFE_INTEGER) <= 3 * 60 * 1000)
    .filter((s) => !s?.abortedLastRun)
    .map((s) => ({
      id: s.key,
      task: s.lastUserMessage || s.sessionId || s.key,
      status: 'Active',
      source: 'OpenClaw sessions (last 3m)'
    }));

  const diagnostics = buildInProgressSyncDiagnostics(rawInProgress, inProgressTasks);
  const behaviorGap = computeBehaviorGapMetrics(board);
  const pantryPalWip = computePantryPalWipMetrics(board, { threshold: 0.6, minActiveWip: 3 });
  const strategicQueue = computeStrategicQueueMetrics(board, { reserveShare: 0.3, nonStrategicCeiling: 0.7, minActiveQueue: 3 });
  const todoCards = Array.isArray(board?.columns?.todo) ? board.columns.todo : [];
  const inProgressCards = Array.isArray(board?.columns?.inProgress) ? board.columns.inProgress : [];
  const guardrailedTodo = prioritizeWithGuardrails(todoCards, {
    syntheticCap: 2,
    strategicReserveShare: 0.3,
    nonStrategicCeiling: 0.7,
    existingActiveTasks: [...todoCards, ...inProgressCards]
  });
  const managerLoopMetrics = computeManagerLoopMetrics(board, { staleMinutes: 20 });
  const managerLoopThresholds = evaluateManagerLoopThresholds(managerLoopMetrics);

  return {
    // Backward-compatible merged list used by current UI
    items: [...activeSubagents, ...inProgressTasks],
    // Explicit contract fields for integrations
    activeSubagents,
    inProgressTasks: inProgressTasks.map(({ _kanbanId, ...task }) => task),
    diagnostics,
    behaviorGap,
    pantryPalWip,
    strategicQueue,
    recommendedTodoOrder: guardrailedTodo.prioritized.map((task) => ({
      id: task.id,
      name: task.name,
      priority: VALID_PRIORITIES.includes(task?.priority) ? task.priority : 'medium'
    })),
    quarantinedTodoCandidates: guardrailedTodo.quarantined.map((task) => ({
      id: task.id,
      name: task.name,
      priority: VALID_PRIORITIES.includes(task?.priority) ? task.priority : 'medium'
    })),
    managerLoop: {
      metrics: managerLoopMetrics,
      thresholdEvaluation: managerLoopThresholds,
      autoNextAction: {
        changed: scheduleResult.changed,
        reason: scheduleResult.reason,
        dispatchedTaskId: scheduleResult.dispatchedTaskId
      }
    },
    reason: diagnostics.syncOk ? null : 'kanban inProgress and dashboard payload require reconciliation',
    counts: {
      activeSubagents: activeSubagents.length,
      inProgressTasks: inProgressTasks.length
    }
  };
}

async function getLiveAgentActivityData() {
  const board = await loadKanban();
  const telemetry = await getOpenClawTelemetry();
  const live = buildLiveAgentActivity({ board, sessions: telemetry.sessions, runs: telemetry.runs, now: new Date() });

  return {
    title: 'Live Agent Activity',
    items: live.items,
    counts: live.counts,
    telemetry: telemetry.diagnostics
  };
}

async function getSessionsData() {
  const entries = [];

  try {
    const files = await fs.readdir(MEMORY_DIR);
    for (const file of files.filter((f) => f.endsWith('.md'))) {
      const full = path.join(MEMORY_DIR, file);
      const stat = await fs.stat(full);
      entries.push({
        timestamp: stat.mtime.toISOString(),
        source: `memory/${file}`,
        summary: 'Daily memory note updated'
      });
    }
  } catch {
    entries.push({
      timestamp: nowIso(),
      source: 'memory/',
      summary: 'No memory directory found or unreadable'
    });
  }

  const gitLog = await safeExec("git log --date=iso --pretty=format:'%ad|%h|%s' -n 15");
  if (gitLog.ok && gitLog.stdout.trim()) {
    for (const line of gitLog.stdout.split('\n')) {
      const [timestamp, hash, summary] = line.split('|');
      entries.push({
        timestamp,
        source: `git:${hash}`,
        summary: summary || 'Commit activity'
      });
    }
  } else {
    entries.push({ timestamp: nowIso(), source: 'git', summary: 'Git log unavailable' });
  }

  return entries.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp)).slice(0, 20);
}

async function getErrorData() {
  const sources = [path.join(WORKSPACE, 'HEARTBEAT.md'), getKanbanPath()];

  try {
    const memFiles = await fs.readdir(MEMORY_DIR);
    memFiles.filter((f) => f.endsWith('.md')).forEach((f) => sources.push(path.join(MEMORY_DIR, f)));
  } catch {}

  const out = [];
  const rx = /(error|failed|failure|blocker|issue|unavailable|timeout)/i;

  for (const file of sources) {
    const content = await readIfExists(file);
    if (!content) continue;
    const lines = content.split('\n');
    lines.forEach((line, i) => {
      if (rx.test(line)) {
        out.push({
          timestamp: nowIso(),
          source: path.relative(WORKSPACE, file),
          message: `L${i + 1}: ${line.trim()}`
        });
      }
    });
  }

  if (!out.length) {
    out.push({
      timestamp: nowIso(),
      source: 'system',
      message: 'No explicit failure lines found in scanned local artifacts.'
    });
  }

  return out.slice(0, 50);
}

async function getTokenUsageData() {
  const filesToScan = [getKanbanPath()];
  const totals = { promptTokens: 0, completionTokens: 0, estimatedCostUsd: 0 };

  for (const file of filesToScan) {
    const content = await readIfExists(file);
    if (!content) continue;
    const tokenMatches = [...content.matchAll(/(\d[\d,]*)\s*tokens?/gi)];
    tokenMatches.forEach((m) => {
      totals.promptTokens += Number((m[1] || '0').replace(/,/g, ''));
    });
    const costMatches = [...content.matchAll(/\$\s*(\d+(?:\.\d+)?)/g)];
    costMatches.forEach((m) => {
      totals.estimatedCostUsd += Number(m[1] || 0);
    });
  }

  const quota = Number(process.env.OPS_HUB_TOKEN_QUOTA || 1000000);
  const used = totals.promptTokens + totals.completionTokens;

  return {
    ...totals,
    quota,
    used,
    quotaPct: quota > 0 ? Number(((used / quota) * 100).toFixed(2)) : 0,
    reason:
      used > 0
        ? 'Derived from local text artifacts containing token/cost markers.'
        : 'No token telemetry files were found. Set OPS_HUB_TOKEN_QUOTA and provide usage artifacts for accurate tracking.'
  };
}

async function getActivityFeed() {
  const items = [];
  const gitLog = await safeExec("git log --date=iso --pretty=format:'%ad|%s' -n 20");

  if (gitLog.ok && gitLog.stdout.trim()) {
    gitLog.stdout.split('\n').forEach((line) => {
      const [timestamp, action] = line.split('|');
      items.push({ timestamp, action: action || 'Git activity', source: 'git log' });
    });
  }

  if (!items.length) {
    items.push({
      timestamp: nowIso(),
      action: 'No activity feed source available',
      source: 'system placeholder'
    });
  }

  return items.slice(0, 20);
}

function asyncHandler(fn) {
  return (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
}

function createApp() {
  const app = express();
  app.use(express.static(path.join(__dirname, 'public')));
  app.use(express.json({ limit: '64kb' }));

  app.get('/api/health', (_req, res) => {
    res.json({ status: 'ok', service: 'OpsHub', timestamp: nowIso(), uptimeSeconds: Math.floor(process.uptime()) });
  });

  app.get(
    '/api/dashboard',
    asyncHandler(async (_req, res) => {
      const [subagents, liveAgentActivity, sessions, errors, tokenUsage, activity] = await Promise.all([
        getSubagentsData(),
        getLiveAgentActivityData(),
        getSessionsData(),
        getErrorData(),
        getTokenUsageData(),
        getActivityFeed()
      ]);

      res.json({
        generatedAt: nowIso(),
        refreshSeconds: 60,
        subagents,
        liveAgentActivity,
        sessions,
        errors,
        tokenUsage,
        activity
      });
    })
  );

  app.get(
    '/api/live-activity',
    asyncHandler(async (_req, res) => {
      const liveAgentActivity = await getLiveAgentActivityData();
      res.json({ generatedAt: nowIso(), refreshSeconds: 15, liveAgentActivity });
    })
  );

  app.get(
    '/api/kanban',
    asyncHandler(async (_req, res) => {
      const board = await loadKanban();
      res.json({ generatedAt: nowIso(), board });
    })
  );

  app.post(
    '/api/kanban/task',
    asyncHandler(async (req, res) => {
      const {
        name,
        description,
        priority,
        status = 'backlog',
        source = 'manual',
        correctionOccurred,
        correctionLog,
        completionDetails,
        verification,
        blockerProtocol,
        blocker
      } = req.body || {};
      const cleanedName = cleanText(name, 200);
      if (!cleanedName) return res.status(400).json({ error: 'name is required' });

      const target = VALID_COLUMNS.includes(status) ? status : 'backlog';
      const cleanedDescription = cleanText(description, 2000);
      const cleanedCompletionDetails = cleanText(completionDetails, 2000);
      const board = await loadKanban();

      if (ACTIVE_COLUMNS.includes(target)) {
        const admission = validateTaskAdmission({ board, name: cleanedName, description: cleanedDescription, source, targetColumn: target });
        if (!admission.ok) {
          return res.status(admission.status).json({ error: admission.error, code: admission.code, duplicateTaskId: admission.duplicateTaskId || null });
        }
      }

      if (target === 'inProgress') {
        const wipGate = enforceInProgressWipLimit(board, priority);
        if (!wipGate.ok) {
          return res.status(wipGate.status).json({ error: wipGate.error, code: wipGate.code, limits: wipGate.limits });
        }
      }

      if (target === 'done') {
        const completionText = cleanedCompletionDetails || cleanedDescription;
        const gate = validateHumanFacingUpdate({ text: completionText, requireGitHubEvidence: true });
        if (!gate.pass) {
          return res.status(400).json({
            error: 'done task description failed human-facing output policy gate',
            issues: gate.issues
          });
        }
        if (!hasRequiredDoneVerification({}, { verification })) {
          return res.status(422).json({
            error: 'done transition requires verification.command + verification.result=pass + verification.verifiedAt',
            code: 'MISSING_REQUIRED_DONE_VERIFICATION'
          });
        }
        if (Boolean(correctionOccurred) && !hasCorrectionLogRecord({}, { correctionLog })) {
          return res.status(422).json({
            error: 'done transition requires correction log when correction occurred',
            code: 'MISSING_CORRECTION_LOG'
          });
        }
      }
      const task = newTask({ name: cleanedName, description: cleanedDescription, priority, source });
      task.status = target;
      if (target === 'done') {
        task.completedAt = nowIso();
        task.completionDetails = cleanedCompletionDetails || cleanedDescription;
        task.verification = verification || null;
        task.correctionOccurred = Boolean(correctionOccurred);
        task.correctionLog = correctionLog || null;
      }

      const blockerEval = evaluateBlockerProtocol({ blockerProtocol, blocker });
      let blockerProofPath = null;
      if (blockerEval.blockerDetected) {
        task.blockerProtocol = {
          ...(task.blockerProtocol || {}),
          autoSpawned: true,
          autoSpawnedAt: nowIso(),
          assignedAgent: 'blocker-handler',
          attempts: blockerEval.attempts,
          escalation: blockerProtocol?.escalation || blocker?.escalation || null
        };
        blockerProofPath = await captureBlockerProofArtifact({
          artifactDir: BLOCKER_PROOF_DIR,
          taskId: task.id,
          from: null,
          to: target,
          protocolEval: blockerEval,
          payload: { blockerProtocol, blocker }
        });
      }

      board.columns[target].unshift(task);
      pushActivity(board, {
        type: 'task_added',
        taskId: task.id,
        taskName: task.name,
        to: target,
        detail: `Added task from ${task.source}`
      });
      if (blockerEval.blockerDetected) {
        pushActivity(board, {
          type: 'blocker_handler_spawned',
          taskId: task.id,
          taskName: task.name,
          to: target,
          detail: 'Auto-spawned blocker-handler due to blocker detection'
        });
      }
      if (blockerProofPath) {
        pushActivity(board, {
          type: 'blocker_proof_captured',
          taskId: task.id,
          taskName: task.name,
          to: target,
          detail: blockerProofPath
        });
      }

      await saveKanban(board);
      res.json({ ok: true, task, board });
    })
  );

  app.post(
    '/api/kanban/move',
    asyncHandler(async (req, res) => {
      const {
        taskId,
        to,
        summary = '',
        completionDetails = '',
        correctionOccurred,
        correctionLog,
        verification,
        blockerProtocol,
        blocker
      } = req.body || {};
      if (!taskId || !to) return res.status(400).json({ error: 'taskId and to are required' });
      if (!VALID_COLUMNS.includes(to)) return res.status(400).json({ error: 'invalid target column' });

      const board = await loadKanban();
      const found = findTask(board, taskId);
      if (!found) return res.status(404).json({ error: 'task not found' });

      const [task] = board.columns[found.col].splice(found.idx, 1);
      const from = found.col;

      const blockerEval = evaluateBlockerProtocol({
        blockerProtocol: blockerProtocol
          ? { ...blockerProtocol, autoSpawned: blockerProtocol.autoSpawned || Boolean(blockerProtocol.detected || blockerProtocol.summary || blockerProtocol.reason) }
          : blockerProtocol,
        blocker: blocker ? { ...blocker, autoSpawned: blocker.autoSpawned || Boolean(blocker.detected || blocker.summary || blocker.reason) } : blocker
      });

      if (blockerEval.escalationRequested && !blockerEval.compliant) {
        board.columns[found.col].splice(found.idx, 0, task);
        return res.status(422).json({
          error: 'blocker escalation rejected: protocol requires auto blocker-handler + exactly 2 Claude Code attempts with proof',
          code: 'BLOCKER_PROTOCOL_NON_COMPLIANT',
          issues: blockerEval.issues
        });
      }

      const cleanedSummary = cleanText(summary, 500);
      const cleanedCompletionDetails = cleanText(completionDetails, 2000);
      let blockerProofPath = null;

      if (ACTIVE_COLUMNS.includes(to)) {
        const admission = validateTaskAdmission({
          board,
          name: task.name,
          description: task.description,
          source: task.source,
          targetColumn: to,
          excludingTaskId: task.id
        });
        if (!admission.ok) {
          board.columns[found.col].splice(found.idx, 0, task);
          return res.status(admission.status).json({ error: admission.error, code: admission.code, duplicateTaskId: admission.duplicateTaskId || null });
        }
      }

      if (to === 'inProgress') {
        const wipGate = enforceInProgressWipLimit(board, task?.priority);
        if (!wipGate.ok && from !== 'inProgress') {
          board.columns[found.col].splice(found.idx, 0, task);
          return res.status(wipGate.status).json({ error: wipGate.error, code: wipGate.code, limits: wipGate.limits });
        }
      }
      if (blockerEval.blockerDetected) {
        task.blockerProtocol = {
          ...(task.blockerProtocol || {}),
          autoSpawned: true,
          autoSpawnedAt: nowIso(),
          assignedAgent: 'blocker-handler',
          attempts: blockerEval.attempts,
          escalation: blockerProtocol?.escalation || blocker?.escalation || null
        };
      }

      if (to === 'done') {
        const completionText = cleanedCompletionDetails || cleanedSummary || task.completionDetails || task.description;
        const gate = validateHumanFacingUpdate({ text: completionText, requireGitHubEvidence: true });
        if (!gate.pass) {
          board.columns[found.col].splice(found.idx, 0, task);
          upsertCloseoutReminder(board, task, gate.issues.map((issue) => issue.code || issue.message));
          await saveKanban(board);
          return res.status(400).json({
            error: 'done transition failed human-facing output policy gate',
            issues: gate.issues
          });
        }

        if (!hasRequiredDoneVerification(task, { verification })) {
          board.columns[found.col].splice(found.idx, 0, task);
          upsertCloseoutReminder(board, task, ['MISSING_REQUIRED_DONE_VERIFICATION']);
          await saveKanban(board);
          return res.status(422).json({
            error: 'done transition requires verification.command + verification.result=pass + verification.verifiedAt',
            code: 'MISSING_REQUIRED_DONE_VERIFICATION'
          });
        }

        const correctionOccurredFlag = didCorrectionOccur(task, { correctionOccurred });
        if (correctionOccurredFlag && !hasCorrectionLogRecord(task, { correctionLog })) {
          board.columns[found.col].splice(found.idx, 0, task);
          upsertCloseoutReminder(board, task, ['MISSING_CORRECTION_LOG']);
          await saveKanban(board);
          return res.status(422).json({
            error: 'done transition requires correction log when correction occurred',
            code: 'MISSING_CORRECTION_LOG'
          });
        }

        task.completionDetails = completionText;
        task.correctionOccurred = correctionOccurredFlag;
        if (correctionLog) task.correctionLog = correctionLog;
        if (verification) task.verification = verification;
      }

      if (to === 'inProgress' && requiresDelegationTrigger(task)) {
        task.delegation = {
          ...(task.delegation || {}),
          required: true,
          triggeredAt: nowIso(),
          trigger: 'complexity/context threshold exceeded'
        };
      }

      task.status = to;
      if (to === 'done' && !task.completedAt) task.completedAt = nowIso();
      if (to !== 'done') task.completedAt = null;

      board.columns[to].unshift(task);
      pushActivity(board, {
        type: 'task_moved',
        taskId: task.id,
        taskName: task.name,
        from,
        to,
        detail: cleanedSummary
      });
      if (to === 'inProgress' && task?.delegation?.required) {
        pushActivity(board, {
          type: 'delegation_triggered',
          taskId: task.id,
          taskName: task.name,
          from,
          to,
          detail: 'Delegation trigger enforced: complexity/context threshold exceeded'
        });
      }
      if (blockerEval.blockerDetected) {
        pushActivity(board, {
          type: 'blocker_handler_spawned',
          taskId: task.id,
          taskName: task.name,
          from,
          to,
          detail: 'Auto-spawned blocker-handler due to blocker detection'
        });
        blockerProofPath = await captureBlockerProofArtifact({
          artifactDir: BLOCKER_PROOF_DIR,
          taskId: task.id,
          from,
          to,
          protocolEval: blockerEval,
          payload: { blockerProtocol, blocker }
        });
      }
      if (blockerProofPath) {
        pushActivity(board, {
          type: 'blocker_proof_captured',
          taskId: task.id,
          taskName: task.name,
          from,
          to,
          detail: blockerProofPath
        });
      }

      await saveKanban(board);
      res.json({ ok: true, task, board });
    })
  );

  app.use((err, _req, res, _next) => {
    console.error('[OpsHub] request failed:', err);
    res.status(500).json({ error: 'internal server error' });
  });

  return app;
}

function startServer(port = PORT) {
  const app = createApp();
  const server = app.listen(port, () => {
    const actualPort = server.address()?.port ?? port;
    console.log(`OpsHub running at http://localhost:${actualPort}`);
  });
  return server;
}

if (require.main === module) {
  startServer();
}

module.exports = {
  createApp,
  startServer,
  loadKanban,
  saveKanban,
  normalizeInProgressTask,
  buildInProgressSyncDiagnostics,
  computeBehaviorGapMetrics,
  getOpenClawTelemetry,
  getLiveAgentActivityData
};
