const test = require('node:test');
const assert = require('node:assert/strict');

const { resolveSlackUpdateTarget, routeHeartbeatPost } = require('../scripts/slack-target-resolver');

function makeLogger() {
  const calls = [];
  return {
    calls,
    warn: (msg) => calls.push(['warn', msg]),
    info: (msg) => calls.push(['info', msg])
  };
}

test('resolveSlackUpdateTarget uses configured channel id directly', async () => {
  const logger = makeLogger();
  const result = await resolveSlackUpdateTarget({
    configuredTarget: 'C1234567890',
    fallbackChannelName: 'ops-updates',
    logger
  });

  assert.equal(result.ok, true);
  assert.equal(result.target, 'C1234567890');
  assert.equal(result.method, 'configured-id');
  assert.equal(logger.calls.length, 0);
});

test('resolveSlackUpdateTarget falls back from missing configured name to fallback channel name lookup', async () => {
  const logger = makeLogger();
  const result = await resolveSlackUpdateTarget({
    configuredTarget: '#unknown-channel',
    fallbackChannelName: '#ops-updates',
    listChannels: async () => [
      { id: 'C1111111111', name: 'general' },
      { id: 'C2222222222', name: 'ops-updates' }
    ],
    logger
  });

  assert.equal(result.ok, true);
  assert.equal(result.target, 'C2222222222');
  assert.equal(result.method, 'fallback-name');
  assert.equal(logger.calls.length, 0);
});

test('routeHeartbeatPost performs safe no-op with logging when target cannot be resolved', async () => {
  const logger = makeLogger();
  let sent = false;

  const result = await routeHeartbeatPost({
    text: 'heartbeat update',
    sendMessage: async () => {
      sent = true;
    },
    resolverOptions: {
      configuredTarget: '#does-not-exist',
      fallbackChannelName: '#still-missing',
      listChannels: async () => [{ id: 'C3333333333', name: 'random' }]
    },
    logger
  });

  assert.equal(result.ok, false);
  assert.equal(result.noop, true);
  assert.equal(result.reason, 'target_not_found');
  assert.equal(sent, false);
  assert.equal(logger.calls.some(([level, msg]) => level === 'warn' && msg.includes('unable to resolve Slack target')), true);
  assert.equal(logger.calls.some(([level, msg]) => level === 'info' && msg.includes('no-op route')), true);
});
