const { redactValue } = require('./redaction');

function cleanText(value, maxLen = 500) {
  const str = String(value ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').trim();
  return str.length > maxLen ? str.slice(0, maxLen) : str;
}

function toIso(value, fallbackIso) {
  const d = new Date(value);
  if (!Number.isNaN(d.getTime())) return d.toISOString();
  return fallbackIso;
}

function deriveAgent(session = {}) {
  const explicit = cleanText(session.agent || session.agentName || '', 120);
  if (explicit) return explicit;
  const key = cleanText(session.key || session.sessionKey || session.sessionId || '', 300);
  const parts = key.split(':').filter(Boolean);
  if (parts.includes('subagent')) return parts[Math.max(0, parts.indexOf('subagent') - 1)] || 'subagent';
  return parts[parts.length - 1] || 'unknown-agent';
}

function normalizeTimelineEvent(raw = {}, fallbackIso, source = 'run') {
  const toolName = cleanText(raw.tool || raw.toolName || raw.name || raw.action || '', 120) || 'unknown-tool';
  const timestamp = toIso(raw.timestamp || raw.at || raw.startedAt || raw.updatedAt || raw.time, fallbackIso);
  const status = cleanText(raw.status || raw.outcome || raw.resultStatus || (raw.success === true ? 'success' : raw.success === false ? 'error' : ''), 40) || 'unknown';

  const inputRaw = raw.input ?? raw.args ?? raw.arguments ?? raw.parameters ?? raw.payload ?? null;
  const outputRaw = raw.output ?? raw.result ?? raw.response ?? raw.error ?? null;

  return {
    timestamp,
    source,
    toolName,
    status,
    input: redactValue(inputRaw),
    output: redactValue(outputRaw)
  };
}

function collectRunTimeline(run = {}, nowIso) {
  const events = [];
  const candidates = [run.toolCalls, run.events, run.steps, run.timeline].filter(Array.isArray);
  for (const bucket of candidates) {
    for (const raw of bucket) {
      if (!raw || typeof raw !== 'object') continue;
      const hasToolHint = raw.tool || raw.toolName || raw.name || raw.action;
      if (!hasToolHint) continue;
      events.push(normalizeTimelineEvent(raw, nowIso, 'run'));
    }
  }
  return events;
}

function collectSessionTimeline(session = {}, nowIso) {
  const events = [];
  const candidates = [session.events, session.timeline, session.toolCalls].filter(Array.isArray);
  for (const bucket of candidates) {
    for (const raw of bucket) {
      if (!raw || typeof raw !== 'object') continue;
      const hasToolHint = raw.tool || raw.toolName || raw.name || raw.action;
      if (!hasToolHint) continue;
      events.push(normalizeTimelineEvent(raw, nowIso, 'session'));
    }
  }
  return events;
}

function mergeRunsBySession(runs = []) {
  const bySession = new Map();
  for (const run of runs) {
    const sessionKey = cleanText(run?.sessionKey || run?.sessionId || run?.session || '', 300);
    if (!sessionKey) continue;
    const prior = bySession.get(sessionKey);
    const priorTs = new Date(prior?.updatedAt || prior?.lastUpdate || prior?.startedAt || 0).getTime();
    const nextTs = new Date(run?.updatedAt || run?.lastUpdate || run?.startedAt || 0).getTime();
    if (!prior || nextTs >= priorTs) bySession.set(sessionKey, run);
  }
  return bySession;
}

function sortTimeline(events = []) {
  return [...events].sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
}

function buildAgentActivitySummary({ sessions = [], runs = [], now = new Date() }) {
  const nowIso = now.toISOString();
  const runBySession = mergeRunsBySession(runs);

  const agents = sessions.map((session) => {
    const sessionKey = cleanText(session?.key || session?.sessionKey || session?.sessionId || '', 300);
    const run = runBySession.get(sessionKey);
    const runEvents = collectRunTimeline(run || {}, nowIso);
    const sessionEvents = collectSessionTimeline(session, nowIso);
    const timelineEvents = sortTimeline([...runEvents, ...sessionEvents]);

    return {
      sessionKey,
      sessionId: cleanText(session?.sessionId || '', 200) || null,
      agent: deriveAgent(session),
      state: cleanText(run?.state || run?.status || session?.state || session?.status || 'active', 80),
      lastUpdate: toIso(run?.updatedAt || run?.lastUpdate || session?.updatedAt || session?.lastUpdate || session?.touchedAt, nowIso),
      lastMessage: cleanText(session?.lastUserMessage || session?.task || run?.task || '', 400) || null,
      toolEventCount: timelineEvents.length,
      latestTool: timelineEvents[0]?.toolName || null,
      latestStatus: timelineEvents[0]?.status || null
    };
  });

  agents.sort((a, b) => new Date(b.lastUpdate).getTime() - new Date(a.lastUpdate).getTime());

  return {
    generatedAt: nowIso,
    refreshSeconds: 5,
    counts: {
      activeSessions: agents.length,
      runs: runs.length,
      sessionsWithToolEvents: agents.filter((agent) => agent.toolEventCount > 0).length
    },
    agents
  };
}

function buildAgentTrace({ sessionKey, sessions = [], runs = [], now = new Date() }) {
  const nowIso = now.toISOString();
  const safeSessionKey = cleanText(sessionKey, 300);
  const session = sessions.find((item) => cleanText(item?.key || item?.sessionKey || item?.sessionId || '', 300) === safeSessionKey) || null;
  const run = runs
    .filter((item) => cleanText(item?.sessionKey || item?.sessionId || item?.session || '', 300) === safeSessionKey)
    .sort((a, b) => new Date(b?.updatedAt || b?.lastUpdate || 0).getTime() - new Date(a?.updatedAt || a?.lastUpdate || 0).getTime())[0] || null;

  const timeline = sortTimeline([
    ...collectSessionTimeline(session || {}, nowIso),
    ...collectRunTimeline(run || {}, nowIso)
  ]);

  return {
    generatedAt: nowIso,
    refreshSeconds: 5,
    sessionKey: safeSessionKey,
    agent: deriveAgent(session || {}),
    state: cleanText(run?.state || run?.status || session?.state || session?.status || 'active', 80),
    runId: cleanText(run?.id || run?.runId || '', 120) || null,
    timeline
  };
}

module.exports = {
  buildAgentActivitySummary,
  buildAgentTrace
};
