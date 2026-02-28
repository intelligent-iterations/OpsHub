const express = require('express');
const fs = require('fs/promises');
const path = require('path');
const { exec } = require('child_process');
const util = require('util');
const crypto = require('crypto');
const { computePantryPalWipMetrics, computeStrategicQueueMetrics, prioritizeWithGuardrails } = require('./scripts/pantrypal-priority-guardrails');
const { validateHumanFacingUpdate } = require('./lib/human-deliverable-guard');

const execAsync = util.promisify(exec);
const PORT = Number(process.env.PORT) || 4180;
const WORKSPACE = path.resolve(__dirname, '..');
const MEMORY_DIR = path.join(WORKSPACE, 'memory');
const OPSHUB_DIR = __dirname;
const DATA_DIR = process.env.OPSHUB_DATA_DIR
  ? path.resolve(process.env.OPSHUB_DATA_DIR)
  : path.join(OPSHUB_DIR, 'data');
const KANBAN_PATH = path.join(DATA_DIR, 'kanban.json');

const VALID_COLUMNS = ['backlog', 'todo', 'inProgress', 'done'];
const VALID_PRIORITIES = ['high', 'medium', 'low'];

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

function hasVerificationRecord(task, payload = {}) {
  const inbound = payload.verification || payload?.metadata?.verification || payload.verifiedAt;
  return Boolean(inbound || task?.verification || task?.metadata?.verification || task?.verifiedAt || task?.metadata?.verifiedAt);
}

function cleanText(value, maxLen = 3000) {
  const str = String(value ?? '')
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .trim();
  return str.length > maxLen ? str.slice(0, maxLen) : str;
}

async function ensureDataDir() {
  await fs.mkdir(DATA_DIR, { recursive: true });
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
    const content = await fs.readFile(KANBAN_PATH, 'utf8');
    return normalizeBoard(JSON.parse(content));
  } catch {
    const initial = defaultKanban();
    await saveKanban(initial);
    return initial;
  }
}

async function saveKanban(board) {
  await ensureDataDir();
  const tmpPath = `${KANBAN_PATH}.tmp`;
  await fs.writeFile(tmpPath, JSON.stringify(board, null, 2), 'utf8');
  await fs.rename(tmpPath, KANBAN_PATH);
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

async function getSubagentsData() {
  const board = await loadKanban();

  // 1) Ground truth for current tasks = kanban In Progress
  const rawInProgress = Array.isArray(board?.columns?.inProgress) ? board.columns.inProgress : [];
  const inProgressTasks = rawInProgress.map((t, idx) => normalizeInProgressTask(t, idx));

  // 2) Runtime sub-agent sessions from OpenClaw session store (recently active only)
  const sess = await safeExec('~/.openclaw/bin/openclaw sessions --active 30 --json');
  let activeSubagents = [];

  if (sess.ok && sess.stdout?.trim()) {
    try {
      const parsed = JSON.parse(sess.stdout);
      const sessions = Array.isArray(parsed?.sessions) ? parsed.sessions : [];
      activeSubagents = sessions
        .filter((s) => typeof s?.key === 'string' && s.key.includes(':subagent:'))
        .filter((s) => Number(s?.ageMs ?? Number.MAX_SAFE_INTEGER) <= 3 * 60 * 1000)
        .filter((s) => !s?.abortedLastRun)
        .map((s) => ({
          id: s.key,
          task: s.lastUserMessage || s.sessionId || s.key,
          status: 'Active',
          source: 'OpenClaw sessions (last 3m)'
        }));
    } catch {
      activeSubagents = [];
    }
  }

  const diagnostics = buildInProgressSyncDiagnostics(rawInProgress, inProgressTasks);
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

  return {
    // Backward-compatible merged list used by current UI
    items: [...activeSubagents, ...inProgressTasks],
    // Explicit contract fields for integrations
    activeSubagents,
    inProgressTasks: inProgressTasks.map(({ _kanbanId, ...task }) => task),
    diagnostics,
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
    reason: diagnostics.syncOk ? null : 'kanban inProgress and dashboard payload require reconciliation',
    counts: {
      activeSubagents: activeSubagents.length,
      inProgressTasks: inProgressTasks.length
    }
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
  const sources = [path.join(WORKSPACE, 'HEARTBEAT.md'), KANBAN_PATH];

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
  const filesToScan = [KANBAN_PATH];
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
      const [subagents, sessions, errors, tokenUsage, activity] = await Promise.all([
        getSubagentsData(),
        getSessionsData(),
        getErrorData(),
        getTokenUsageData(),
        getActivityFeed()
      ]);

      res.json({
        generatedAt: nowIso(),
        refreshSeconds: 60,
        subagents,
        sessions,
        errors,
        tokenUsage,
        activity
      });
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
      const { name, description, priority, status = 'backlog', source = 'manual', correctionOccurred, correctionLog, verification } = req.body || {};
      const cleanedName = cleanText(name, 200);
      if (!cleanedName) return res.status(400).json({ error: 'name is required' });

      const target = VALID_COLUMNS.includes(status) ? status : 'backlog';
      const cleanedDescription = cleanText(description, 2000);
      if (target === 'done') {
        const gate = validateHumanFacingUpdate({ text: cleanedDescription, requireGitHubEvidence: true });
        if (!gate.pass) {
          return res.status(400).json({
            error: 'done task description failed human-facing output policy gate',
            issues: gate.issues
          });
        }
        if (!hasVerificationRecord({}, { verification })) {
          return res.status(422).json({
            error: 'done transition requires verification record',
            code: 'MISSING_VERIFICATION_RECORD'
          });
        }
        if (Boolean(correctionOccurred) && !hasCorrectionLogRecord({}, { correctionLog })) {
          return res.status(422).json({
            error: 'done transition requires correction log when correction occurred',
            code: 'MISSING_CORRECTION_LOG'
          });
        }
      }

      const board = await loadKanban();
      const task = newTask({ name: cleanedName, description: cleanedDescription, priority, source });
      task.status = target;
      if (target === 'done') {
        task.completedAt = nowIso();
        task.verification = verification || null;
        task.correctionOccurred = Boolean(correctionOccurred);
        task.correctionLog = correctionLog || null;
      }

      board.columns[target].unshift(task);
      pushActivity(board, {
        type: 'task_added',
        taskId: task.id,
        taskName: task.name,
        to: target,
        detail: `Added task from ${task.source}`
      });

      await saveKanban(board);
      res.json({ ok: true, task, board });
    })
  );

  app.post(
    '/api/kanban/move',
    asyncHandler(async (req, res) => {
      const { taskId, to, summary = '', completionDetails = '', correctionOccurred, correctionLog, verification } = req.body || {};
      if (!taskId || !to) return res.status(400).json({ error: 'taskId and to are required' });
      if (!VALID_COLUMNS.includes(to)) return res.status(400).json({ error: 'invalid target column' });

      const board = await loadKanban();
      const found = findTask(board, taskId);
      if (!found) return res.status(404).json({ error: 'task not found' });

      const [task] = board.columns[found.col].splice(found.idx, 1);
      const from = found.col;

      const cleanedSummary = cleanText(summary, 500);
      const cleanedCompletionDetails = cleanText(completionDetails, 2000);
      if (to === 'done') {
        const completionText = cleanedCompletionDetails || cleanedSummary || task.completionDetails || task.description;
        const gate = validateHumanFacingUpdate({ text: completionText, requireGitHubEvidence: true });
        if (!gate.pass) {
          board.columns[found.col].splice(found.idx, 0, task);
          return res.status(400).json({
            error: 'done transition failed human-facing output policy gate',
            issues: gate.issues
          });
        }

        if (!hasVerificationRecord(task, { verification })) {
          board.columns[found.col].splice(found.idx, 0, task);
          return res.status(422).json({
            error: 'done transition requires verification record',
            code: 'MISSING_VERIFICATION_RECORD'
          });
        }

        const correctionOccurredFlag = didCorrectionOccur(task, { correctionOccurred });
        if (correctionOccurredFlag && !hasCorrectionLogRecord(task, { correctionLog })) {
          board.columns[found.col].splice(found.idx, 0, task);
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
  buildInProgressSyncDiagnostics
};
