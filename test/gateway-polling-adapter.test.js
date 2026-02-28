const test = require('node:test');
const assert = require('node:assert/strict');

const {
  pollGatewaySubagents,
  normalizeGatewayPayload,
  normalizeGatewayAgent
} = require('../scripts/gateway-polling-adapter');

test('normalizeGatewayAgent maps valid subagent session', () => {
  const agent = normalizeGatewayAgent({
    key: 'main:subagent:abc',
    lastUserMessage: 'Do thing',
    ageMs: 1200
  });

  assert.equal(agent.id, 'main:subagent:abc');
  assert.equal(agent.task, 'Do thing');
  assert.equal(agent.status, 'Active');
  assert.equal(agent.ageMs, 1200);
});

test('normalizeGatewayPayload filters stale and aborted sessions', () => {
  const agents = normalizeGatewayPayload({
    sessions: [
      { key: 'main:subagent:keep', ageMs: 1000, lastUserMessage: 'keep' },
      { key: 'main:subagent:old', ageMs: 500000, lastUserMessage: 'old' },
      { key: 'main:subagent:aborted', ageMs: 100, abortedLastRun: true },
      { key: 'main:regular:session', ageMs: 20 }
    ]
  }, { maxAgentAgeMs: 180000 });

  assert.equal(agents.length, 1);
  assert.equal(agents[0].id, 'main:subagent:keep');
});

test('pollGatewaySubagents returns ok + normalized agents', async () => {
  const result = await pollGatewaySubagents({
    nowIso: () => '2026-02-28T21:40:00.000Z',
    runner: async () => ({
      ok: true,
      stdout: JSON.stringify({
        sessions: [{ key: 'main:subagent:x', lastUserMessage: 'Task X', ageMs: 1000 }]
      })
    })
  });

  assert.equal(result.status, 'ok');
  assert.equal(result.polledAt, '2026-02-28T21:40:00.000Z');
  assert.equal(result.agents.length, 1);
  assert.equal(result.diagnostics.fallbackUsed, false);
});

test('pollGatewaySubagents falls back to unavailable when command fails', async () => {
  const result = await pollGatewaySubagents({
    runner: async () => ({ ok: false, reason: 'command_failed', stderr: 'not found' })
  });

  assert.equal(result.status, 'unavailable');
  assert.equal(result.agents.length, 0);
  assert.equal(result.diagnostics.fallbackUsed, true);
  assert.match(result.diagnostics.reason, /not found|failed/i);
});

test('pollGatewaySubagents returns degraded on malformed JSON', async () => {
  const result = await pollGatewaySubagents({
    runner: async () => ({ ok: true, stdout: '{nope' })
  });

  assert.equal(result.status, 'degraded');
  assert.deepEqual(result.agents, []);
  assert.equal(result.diagnostics.errors[0], 'invalid_gateway_payload');
});
