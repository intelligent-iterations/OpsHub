const test = require('node:test');
const assert = require('node:assert/strict');

const { collectOpenClawTelemetry, parseJsonArray, runFirstOk } = require('../lib/openclaw-telemetry-collector');

test('parseJsonArray returns empty list on invalid payloads', () => {
  assert.deepEqual(parseJsonArray('', 'sessions'), []);
  assert.deepEqual(parseJsonArray('not-json', 'sessions'), []);
  assert.deepEqual(parseJsonArray('{"sessions":{}}', 'sessions'), []);
});

test('runFirstOk returns first successful command result', async () => {
  const seen = [];
  const result = await runFirstOk(['cmd-a', 'cmd-b'], async (command) => {
    seen.push(command);
    if (command === 'cmd-b') return { ok: true, stdout: '{}', stderr: null };
    return { ok: false, stdout: '', stderr: 'fail' };
  });

  assert.deepEqual(seen, ['cmd-a', 'cmd-b']);
  assert.equal(result.ok, true);
  assert.equal(result.command, 'cmd-b');
});

test('collectOpenClawTelemetry reads fixture when provided', async () => {
  const telemetry = await collectOpenClawTelemetry({
    fixturePath: '/tmp/fake.fixture.json',
    execute: async () => {
      throw new Error('execute should not run for fixture path');
    },
    readFile: async () => JSON.stringify({ sessions: [{ id: 's-1' }], runs: [{ id: 'r-1' }] })
  });

  assert.equal(telemetry.sessions.length, 1);
  assert.equal(telemetry.runs.length, 1);
  assert.equal(telemetry.diagnostics.fixture, true);
  assert.equal(telemetry.diagnostics.sessionsCommandOk, true);
});

test('collectOpenClawTelemetry falls back to command diagnostics when commands fail', async () => {
  const telemetry = await collectOpenClawTelemetry({
    fixturePath: null,
    execute: async () => ({ ok: false, stdout: '', stderr: 'missing binary' })
  });

  assert.deepEqual(telemetry.sessions, []);
  assert.deepEqual(telemetry.runs, []);
  assert.equal(telemetry.diagnostics.sessionsCommandOk, false);
  assert.equal(telemetry.diagnostics.runsCommandOk, false);
});

test('collectOpenClawTelemetry parses sessions/runs from command output', async () => {
  const outputs = {
    '~/.openclaw/bin/openclaw sessions --active 30 --json': { ok: true, stdout: '{"sessions":[{"id":"s-live"}]}' },
    '~/.openclaw/bin/openclaw runs --active --json': { ok: true, stdout: '{"runs":[{"id":"r-live"}]}' }
  };

  const telemetry = await collectOpenClawTelemetry({
    fixturePath: null,
    execute: async (command) => outputs[command] || { ok: false, stdout: '', stderr: 'nope' }
  });

  assert.equal(telemetry.sessions[0].id, 's-live');
  assert.equal(telemetry.runs[0].id, 'r-live');
  assert.equal(telemetry.diagnostics.sessionsCommandOk, true);
  assert.equal(telemetry.diagnostics.runsCommandOk, true);
});
