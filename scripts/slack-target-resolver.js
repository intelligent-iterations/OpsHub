function normalizeChannelName(value) {
  return String(value || '')
    .trim()
    .replace(/^#/, '')
    .toLowerCase();
}

function looksLikeChannelId(value) {
  return /^[CGD][A-Z0-9]{8,}$/.test(String(value || '').trim());
}

async function resolveSlackUpdateTarget({
  configuredTarget,
  fallbackChannelName,
  listChannels,
  logger = console
} = {}) {
  const configured = String(configuredTarget || '').trim();
  const fallback = String(fallbackChannelName || '').trim();

  if (looksLikeChannelId(configured)) {
    return {
      ok: true,
      target: configured,
      method: 'configured-id'
    };
  }

  const candidates = [];
  if (configured) candidates.push({ label: 'configured-name', raw: configured, normalized: normalizeChannelName(configured) });
  if (fallback && normalizeChannelName(fallback) !== normalizeChannelName(configured)) {
    candidates.push({ label: 'fallback-name', raw: fallback, normalized: normalizeChannelName(fallback) });
  }

  if (!candidates.length) {
    logger.warn?.('[heartbeat/slack] no Slack target configured; skipping update post');
    return {
      ok: false,
      noop: true,
      reason: 'missing_target_configuration'
    };
  }

  if (typeof listChannels !== 'function') {
    logger.warn?.('[heartbeat/slack] listChannels unavailable; cannot resolve Slack channel name target');
    return {
      ok: false,
      noop: true,
      reason: 'missing_channel_lookup'
    };
  }

  let channels;
  try {
    channels = await listChannels();
  } catch (err) {
    logger.warn?.(`[heartbeat/slack] channel lookup failed; skipping update post (${err?.message || 'unknown error'})`);
    return {
      ok: false,
      noop: true,
      reason: 'channel_lookup_failed'
    };
  }

  const channelList = Array.isArray(channels) ? channels : [];
  for (const candidate of candidates) {
    const match = channelList.find((channel) => normalizeChannelName(channel?.name) === candidate.normalized);
    if (match?.id) {
      return {
        ok: true,
        target: match.id,
        channelName: match.name,
        method: candidate.label
      };
    }
  }

  logger.warn?.(
    `[heartbeat/slack] unable to resolve Slack target (configured="${configured || '(empty)'}", fallback="${fallback || '(empty)'}"); skipping update post`
  );
  return {
    ok: false,
    noop: true,
    reason: 'target_not_found'
  };
}

async function routeHeartbeatPost({
  text,
  threadId,
  sendMessage,
  resolverOptions,
  logger = console
} = {}) {
  const resolved = await resolveSlackUpdateTarget({ ...(resolverOptions || {}), logger });
  if (!resolved.ok) {
    logger.info?.(`[heartbeat/slack] no-op route: ${resolved.reason}`);
    return {
      ok: false,
      noop: true,
      reason: resolved.reason
    };
  }

  if (typeof sendMessage !== 'function') {
    logger.warn?.('[heartbeat/slack] sendMessage unavailable; skipping resolved heartbeat post');
    return {
      ok: false,
      noop: true,
      reason: 'missing_send_message'
    };
  }

  await sendMessage({ target: resolved.target, message: text, threadId });
  return {
    ok: true,
    target: resolved.target,
    method: resolved.method
  };
}

module.exports = {
  resolveSlackUpdateTarget,
  routeHeartbeatPost,
  normalizeChannelName,
  looksLikeChannelId
};
