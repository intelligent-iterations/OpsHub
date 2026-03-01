const path = require('path');
const fs = require('fs/promises');

function parseJsonArray(stdout, key) {
  if (!stdout || !stdout.trim()) return [];
  try {
    const parsed = JSON.parse(stdout);
    return Array.isArray(parsed?.[key]) ? parsed[key] : [];
  } catch {
    return [];
  }
}

async function runFirstOk(commands = [], execute = async () => ({ ok: false })) {
  for (const command of commands) {
    const result = await execute(command);
    if (result?.ok) return { ...result, command };
  }

  return { ok: false, stdout: '', stderr: 'No command succeeded', command: null };
}

async function collectOpenClawTelemetry({
  fixturePath = process.env.OPSHUB_TELEMETRY_FIXTURE,
  execute,
  readFile = (filePath) => fs.readFile(filePath, 'utf8')
} = {}) {
  if (fixturePath) {
    try {
      const fixtureRaw = await readFile(path.resolve(fixturePath));
      const fixture = JSON.parse(fixtureRaw);
      return {
        sessions: Array.isArray(fixture?.sessions) ? fixture.sessions : [],
        runs: Array.isArray(fixture?.runs) ? fixture.runs : [],
        diagnostics: {
          sessionsSource: fixturePath,
          runsSource: fixturePath,
          sessionsCommandOk: true,
          runsCommandOk: true,
          fixture: true
        }
      };
    } catch (err) {
      return {
        sessions: [],
        runs: [],
        diagnostics: {
          sessionsSource: fixturePath,
          runsSource: fixturePath,
          sessionsCommandOk: false,
          runsCommandOk: false,
          fixture: true,
          error: err.message
        }
      };
    }
  }

  const sessionsResult = await runFirstOk(
    ['~/.openclaw/bin/openclaw sessions --active 30 --json', 'openclaw sessions --active 30 --json'],
    execute
  );

  const runsResult = await runFirstOk(
    ['~/.openclaw/bin/openclaw runs --active --json', 'openclaw runs --active --json'],
    execute
  );

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

module.exports = {
  collectOpenClawTelemetry,
  parseJsonArray,
  runFirstOk
};
