const express = require('express');
const fs = require('fs/promises');
const path = require('path');
const { exec } = require('child_process');
const util = require('util');

const execAsync = util.promisify(exec);
const app = express();
const PORT = process.env.PORT || 4180;
const WORKSPACE = path.resolve(__dirname, '..');
const MEMORY_DIR = path.join(WORKSPACE, 'memory');

app.use(express.static(path.join(__dirname, 'public')));

function nowIso() {
  return new Date().toISOString();
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
    const { stdout, stderr } = await execAsync(command, { cwd });
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

function parseTaskStatus(tasksText) {
  if (!tasksText) return [];
  const lines = tasksText.split('\n');
  const sections = [];
  let current = null;

  for (const line of lines) {
    const h = line.match(/^##\s+\d+\)\s+(.*)$/);
    if (h) {
      if (current) sections.push(current);
      current = { title: h[1].trim(), status: 'Unknown', detail: '' };
      continue;
    }
    if (!current) continue;

    const status = line.match(/Current status:\s*\*\*(.*?)\*\*/i);
    if (status) current.status = status[1].trim();
    if (line.startsWith('- Task name:')) current.detail = line.replace('- Task name:', '').trim();
  }

  if (current) sections.push(current);
  return sections;
}

async function getSubagentsData() {
  const tasksText = await readIfExists(path.join(WORKSPACE, 'tasks.md'));
  const taskSections = parseTaskStatus(tasksText);
  const activeFromTasks = taskSections
    .filter((t) => /in progress|active|ongoing/i.test(t.status))
    .map((t) => ({
      id: t.detail || t.title,
      task: t.title,
      status: t.status,
      source: 'tasks.md'
    }));

  const ps = await safeExec("ps -ax -o pid=,command= | grep -i 'subagent' | grep -v grep | head -n 20");
  const activeFromPs = ps.ok
    ? ps.stdout
        .split('\n')
        .filter(Boolean)
        .map((line) => {
          const trimmed = line.trim();
          const firstSpace = trimmed.indexOf(' ');
          return {
            id: firstSpace > -1 ? trimmed.slice(0, firstSpace) : trimmed,
            task: firstSpace > -1 ? trimmed.slice(firstSpace + 1) : trimmed,
            status: 'Running',
            source: 'process list'
          };
        })
    : [];

  const merged = [...activeFromPs, ...activeFromTasks];
  const reason = merged.length
    ? null
    : 'No direct OpenClaw subagent runtime API is available in this environment; showing inferred status only.';

  return { items: merged, reason };
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
    entries.push({
      timestamp: nowIso(),
      source: 'git',
      summary: 'Git log unavailable'
    });
  }

  return entries.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp)).slice(0, 20);
}

async function getErrorData() {
  const sources = [
    path.join(WORKSPACE, 'tasks.md'),
    path.join(WORKSPACE, 'HEARTBEAT.md')
  ];

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
  const filesToScan = [path.join(WORKSPACE, 'tasks.md')];
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

app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', service: 'OpsHub', timestamp: nowIso() });
});

app.get('/api/dashboard', async (_req, res) => {
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
});

app.listen(PORT, () => {
  console.log(`OpsHub running at http://localhost:${PORT}`);
});
