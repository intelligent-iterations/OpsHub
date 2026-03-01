const test = require('node:test');
const assert = require('node:assert/strict');

const {
  redactSensitive,
  normalizeToolCall,
  normalizeRecord,
  parseGatewayLogLine,
  ingestGatewayTelemetry
} = require('../scripts/telemetry-ingestion-layer');

test('redactSensitive redacts sensitive keys recursively', () => {
  const out = redactSensitive({
    token: 'abc',
    nested: {
      apiKey: 'xyz',
      normal: 'ok'
    }
  });

  assert.equal(out.token, '[REDACTED]');
  assert.equal(out.nested.apiKey, '[REDACTED]');
  assert.equal(out.nested.normal, 'ok');
});

test('normalizeToolCall extracts and redacts io', () => {
  const tool = normalizeToolCall({
    toolName: 'exec',
    inputs: { command: 'echo hi', authorization: 'Bearer secret-token' },
    outputs: { stdout: 'hi' },
    exit: 0
  });

  assert.equal(tool.name, 'exec');
  assert.equal(tool.inputs.authorization, '[REDACTED]');
  assert.equal(tool.outputs.stdout, 'hi');
  assert.equal(tool.exit, 0);
});

test('parseGatewayLogLine handles valid json lines', () => {
  const line = JSON.stringify({
    agentId: 'gpt-5',
    sessionKey: 'main:subagent:1',
    active: true,
    toolCall: { toolName: 'read', inputs: { path: 'a' }, outputs: { text: 'x' } },
    startedAt: '2026-02-28T10:00:00.000Z',
    updatedAt: '2026-02-28T10:01:00.000Z'
  });

  const parsed = parseGatewayLogLine(line);
  assert.equal(parsed.ok, true);
  assert.equal(parsed.record.agent, 'gpt-5');
  assert.equal(parsed.record.currentToolCall, 'read');
});

test('parseGatewayLogLine returns invalid_json_line fallback on malformed json', () => {
  const parsed = parseGatewayLogLine('{nope');
  assert.equal(parsed.ok, false);
  assert.equal(parsed.reason, 'invalid_json_line');
});

test('ingestGatewayTelemetry combines logs + traces and preserves schema', () => {
  const logsText = [
    JSON.stringify({
      agentId: 'agent-a',
      sessionKey: 'main:subagent:a',
      active: true,
      toolCall: { toolName: 'exec', inputs: { command: 'npm test' }, outputs: { status: 'ok' }, exit: 0 },
      startedAt: '2026-02-28T10:00:00.000Z',
      updatedAt: '2026-02-28T10:00:10.000Z'
    })
  ].join('\n');

  const report = ingestGatewayTelemetry({
    logsText,
    sessionTraces: [
      {
        agent: 'agent-b',
        session: 'main:subagent:b',
        status: 'active',
        tool: { name: 'read', input: { path: 'x' }, result: { ok: true } },
        ts: '2026-02-28T10:05:00.000Z'
      }
    ]
  });

  assert.equal(report.schemaVersion, 'telemetry.v1');
  assert.equal(report.records.length, 2);
  assert.equal(report.diagnostics.parsedLines, 1);
  assert.equal(report.diagnostics.fallbackUsed, false);
});

test('ingestGatewayTelemetry uses fallback records when nothing parseable is available', () => {
  const report = ingestGatewayTelemetry({
    logsText: 'not-json',
    fallbackRecords: [
      {
        agent: 'fallback-agent',
        session: 'main:fallback',
        active: false,
        toolCall: { toolName: 'none' },
        startedAt: '2026-02-28T12:00:00.000Z',
        updatedAt: '2026-02-28T12:00:00.000Z'
      }
    ]
  });

  assert.equal(report.records.length, 1);
  assert.equal(report.records[0].source, 'fallback');
  assert.equal(report.diagnostics.fallbackUsed, true);
  assert.ok(report.diagnostics.errors.length >= 1);
});
