const SUBAGENT_MARKER = ':subagent:';

function normalizeGatewayAgent(session = {}) {
  const id = typeof session.key === 'string' ? session.key : null;
  if (!id || !id.includes(SUBAGENT_MARKER)) return null;

  const ageMs = Number.isFinite(Number(session.ageMs)) ? Number(session.ageMs) : null;
  const status = session.abortedLastRun ? 'Aborted' : 'Active';

  return {
    id,
    task: session.lastUserMessage || session.sessionId || id,
    status,
    source: 'OpenClaw gateway sessions',
    ageMs,
    owner: typeof session.owner === 'string' ? session.owner : null,
    sessionKey: id
  };
}

function normalizeGatewayPayload(parsed, options = {}) {
  const maxAgentAgeMs = Number.isFinite(options.maxAgentAgeMs) ? Number(options.maxAgentAgeMs) : (3 * 60 * 1000);
  const sessions = Array.isArray(parsed?.sessions) ? parsed.sessions : [];

  const agents = sessions
    .map((session) => normalizeGatewayAgent(session))
    .filter(Boolean)
    .filter((agent) => agent.status !== 'Aborted')
    .filter((agent) => (agent.ageMs == null ? true : agent.ageMs <= maxAgentAgeMs));

  return agents;
}

async function pollGatewaySubagents(options = {}) {
  const nowIso = typeof options.nowIso === 'function' ? options.nowIso : () => new Date().toISOString();
  const runner = options.runner;
  const activeMinutes = Number.isFinite(options.activeMinutes) ? Number(options.activeMinutes) : 30;
  const command = `~/.openclaw/bin/openclaw sessions --active ${activeMinutes} --json`;

  if (typeof runner !== 'function') {
    return {
      status: 'unavailable',
      source: 'OpenClaw gateway sessions',
      polledAt: nowIso(),
      agents: [],
      diagnostics: {
        errors: ['runner_unavailable'],
        attempts: 0,
        fallbackUsed: true,
        reason: 'No gateway runner provided.'
      }
    };
  }

  const result = await runner(command);
  if (!result?.ok) {
    return {
      status: 'unavailable',
      source: 'OpenClaw gateway sessions',
      polledAt: nowIso(),
      agents: [],
      diagnostics: {
        errors: [result?.reason || 'gateway_poll_failed'],
        attempts: 1,
        fallbackUsed: true,
        reason: result?.stderr || result?.stdout || result?.reason || 'Gateway polling command failed.'
      }
    };
  }

  try {
    const parsed = JSON.parse(result.stdout || '{}');
    return {
      status: 'ok',
      source: 'OpenClaw gateway sessions',
      polledAt: nowIso(),
      agents: normalizeGatewayPayload(parsed, options),
      diagnostics: {
        errors: [],
        attempts: 1,
        fallbackUsed: false
      }
    };
  } catch {
    return {
      status: 'degraded',
      source: 'OpenClaw gateway sessions',
      polledAt: nowIso(),
      agents: [],
      diagnostics: {
        errors: ['invalid_gateway_payload'],
        attempts: 1,
        fallbackUsed: true,
        reason: 'Gateway returned invalid JSON payload.'
      }
    };
  }
}

module.exports = {
  pollGatewaySubagents,
  normalizeGatewayPayload,
  normalizeGatewayAgent
};
