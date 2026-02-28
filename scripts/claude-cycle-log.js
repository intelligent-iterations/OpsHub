#!/usr/bin/env node
const fs = require('node:fs');
const path = require('node:path');

const DEFAULT_KANBAN_PATH = path.resolve(__dirname, '..', 'data', 'kanban.json');

function parseCliOptions(argv = []) {
  const options = {};
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token.startsWith('--')) continue;
    const [flag, inlineVal] = token.split('=');
    const value = inlineVal ?? argv[i + 1];
    if (flag === '--task-id')        { options.taskId = value; if (!inlineVal) i += 1; }
    if (flag === '--task-name')      { options.taskName = value; if (!inlineVal) i += 1; }
    if (flag === '--github-link')    { options.githubLink = value; if (!inlineVal) i += 1; }
    if (flag === '--correction-log') { options.correctionLog = value; if (!inlineVal) i += 1; }
    if (flag === '--kanban-file')    { options.kanbanFile = value; if (!inlineVal) i += 1; }
  }
  return options;
}

function validateOptions(options) {
  const missing = [];
  if (!options.taskId)        missing.push('--task-id');
  if (!options.taskName)      missing.push('--task-name');
  if (!options.githubLink)    missing.push('--github-link');
  if (!options.correctionLog) missing.push('--correction-log');
  if (missing.length > 0) {
    return { ok: false, error: `Missing required arguments: ${missing.join(', ')}` };
  }
  try {
    const url = new URL(options.githubLink);
    if (url.hostname !== 'github.com' && !url.hostname.endsWith('.github.com')) {
      return { ok: false, error: `Invalid GitHub link: ${options.githubLink}` };
    }
  } catch {
    return { ok: false, error: `Invalid GitHub link: ${options.githubLink}` };
  }
  return { ok: true };
}

function appendCycleEvidence(options) {
  const kanbanPath = options.kanbanFile
    ? path.resolve(process.cwd(), options.kanbanFile)
    : DEFAULT_KANBAN_PATH;

  const raw = fs.readFileSync(kanbanPath, 'utf8');
  const kanban = JSON.parse(raw);

  if (!Array.isArray(kanban.activityLog)) {
    kanban.activityLog = [];
  }

  const entry = {
    at: new Date().toISOString(),
    type: 'claude_cycle_evidence',
    taskId: options.taskId,
    taskName: options.taskName,
    to: 'done',
    detail: `${options.githubLink} — ${options.correctionLog}`
  };

  kanban.activityLog.unshift(entry);
  fs.writeFileSync(kanbanPath, `${JSON.stringify(kanban, null, 2)}\n`, 'utf8');

  return entry;
}

if (require.main === module) {
  const options = parseCliOptions(process.argv.slice(2));
  const validation = validateOptions(options);
  if (!validation.ok) {
    console.error(validation.error);
    process.exit(1);
  }
  const entry = appendCycleEvidence(options);
  console.log(JSON.stringify(entry, null, 2));
}

module.exports = { parseCliOptions, validateOptions, appendCycleEvidence };
