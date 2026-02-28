function cleanText(value, maxLen = 500) {
  const str = String(value ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').trim();
  return str.length > maxLen ? str.slice(0, maxLen) : str;
}

function normalizeText(value) {
  return cleanText(value, 500).toLowerCase();
}

function deriveAgentLabel(sessionKey = '', fallback = 'unknown-agent') {
  const key = cleanText(sessionKey, 300);
  if (!key) return fallback;
  const parts = key.split(':').filter(Boolean);
  if (!parts.length) return fallback;
  if (parts.includes('subagent')) {
    const idx = parts.indexOf('subagent');
    return parts[idx - 1] || 'subagent';
  }
  return parts[parts.length - 1] || fallback;
}

function toIsoOrNow(value, nowIso) {
  if (!value) return nowIso;
  const d = new Date(value);
  if (!Number.isNaN(d.getTime())) return d.toISOString();
  if (typeof value === 'number' && Number.isFinite(value)) return new Date(value).toISOString();
  return nowIso;
}

function buildTaskMatcher(tasks = []) {
  const normalizedTasks = tasks.map((task) => ({
    task,
    id: normalizeText(task?.id),
    name: normalizeText(task?.name),
    description: normalizeText(task?.description)
  }));

  return function match(candidateText = '', candidateSessionKey = '') {
    const text = normalizeText(candidateText);
    const sessionText = normalizeText(candidateSessionKey);
    let best = null;

    for (const item of normalizedTasks) {
      let score = 0;
      if (item.id && (text.includes(item.id) || sessionText.includes(item.id))) score += 1;
      if (item.name && text.includes(item.name)) score += 3;
      if (item.description && item.description.length > 10 && text.includes(item.description.slice(0, 40))) score += 1;
      if (score > (best?.score || 0)) best = { score, task: item.task };
    }

    if (!best || best.score <= 0) return null;
    return {
      confidence: best.score >= 3 ? 'high' : best.score >= 2 ? 'medium' : 'low',
      score: best.score,
      task: best.task
    };
  };
}

function mergeRunsBySession(runs = []) {
  const out = new Map();
  for (const run of runs) {
    const sessionKey = cleanText(run?.sessionKey || run?.sessionId || run?.session || '', 300);
    if (!sessionKey) continue;
    const prior = out.get(sessionKey);
    const candidateUpdatedAt = new Date(run?.updatedAt || run?.lastUpdate || run?.startedAt || 0).getTime();
    const priorUpdatedAt = new Date(prior?.updatedAt || prior?.lastUpdate || prior?.startedAt || 0).getTime();
    if (!prior || candidateUpdatedAt > priorUpdatedAt) out.set(sessionKey, run);
  }
  return out;
}

function buildLiveAgentActivity({ board, sessions = [], runs = [], now = new Date() }) {
  const nowIso = now.toISOString();
  const inProgress = Array.isArray(board?.columns?.inProgress) ? board.columns.inProgress : [];
  const matchTask = buildTaskMatcher(inProgress);
  const latestRunBySession = mergeRunsBySession(runs);

  const items = sessions.map((session) => {
    const sessionKey = cleanText(session?.key || session?.sessionKey || session?.sessionId || '', 300);
    const run = latestRunBySession.get(sessionKey);
    const sessionTask = cleanText(session?.lastUserMessage || session?.task || session?.label || '', 300);
    const runTask = cleanText(run?.task || run?.title || run?.name || '', 300);
    const combinedTask = runTask || sessionTask || sessionKey || 'Unknown session';
    const state = cleanText(run?.state || run?.status || session?.state || session?.status || 'active', 80);
    const lastUpdate = toIsoOrNow(
      run?.updatedAt || run?.lastUpdate || session?.updatedAt || session?.lastUpdate || session?.touchedAt,
      nowIso
    );

    const mapping = matchTask(`${combinedTask} ${sessionTask} ${runTask}`, sessionKey);

    return {
      agent: cleanText(run?.agent || session?.agent || deriveAgentLabel(sessionKey), 120),
      currentTaskSession: mapping?.task?.name || combinedTask,
      state,
      lastUpdate,
      sessionKey,
      runId: cleanText(run?.id || run?.runId || '', 120) || null,
      mappedTaskId: mapping?.task?.id || null,
      mappedTaskName: mapping?.task?.name || null,
      mappingConfidence: mapping?.confidence || null
    };
  });

  items.sort((a, b) => new Date(b.lastUpdate).getTime() - new Date(a.lastUpdate).getTime());

  return {
    items,
    counts: {
      sessions: sessions.length,
      runs: runs.length,
      mappedTasks: items.filter((item) => item.mappedTaskId).length
    }
  };
}

module.exports = {
  buildLiveAgentActivity,
  deriveAgentLabel
};
