#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const { prioritizeWithGuardrails, mapScoreToPriority } = require('./pantrypal-priority-guardrails');
const { normalizeMode, evaluateSyntheticWriteGuard } = require('../lib/synthetic-write-guard');

function normalizeMentions(rawMentions, text) {
  const fromArray = Array.isArray(rawMentions) ? rawMentions : [];
  const fromText = [];
  const mentionRegex = /<@([A-Z0-9]+)>|@([a-z0-9._-]+)/gi;
  let match;
  while ((match = mentionRegex.exec(String(text || '')))) {
    const value = match[1] || match[2];
    if (value) fromText.push(value.trim());
  }
  const merged = [...fromArray, ...fromText].filter(Boolean);
  return [...new Set(merged.map((entry) => String(entry).trim()).filter(Boolean))];
}

function normalizeMessage(message, idx, channel) {
  const text = String(message?.text || '').trim();
  return {
    id: String(message?.id || message?.ts || `msg-${idx + 1}`),
    ts: String(message?.ts || ''),
    channel: String(message?.channel || channel || ''),
    user: String(message?.user || message?.username || 'unknown'),
    threadTs: message?.thread_ts || null,
    text,
    mentions: normalizeMentions(message?.mentions, text),
    raw: message,
  };
}

function normalizeProviderItems(items) {
  if (Array.isArray(items)) return items;
  if (Array.isArray(items?.messages)) return items.messages;
  return [];
}

async function fetchFromProvider({ channel, limit, listMessages, logger = console }) {
  if (typeof listMessages !== 'function') {
    return {
      attempted: false,
      available: false,
      source: 'provider',
      channel,
      fetchedCount: 0,
      messages: [],
      error: 'provider_not_configured',
    };
  }

  try {
    const items = await listMessages({ channel, limit });
    const messages = normalizeProviderItems(items);
    return {
      attempted: true,
      available: true,
      source: 'provider',
      channel,
      fetchedCount: messages.length,
      messages,
      error: null,
    };
  } catch (err) {
    logger.warn?.(`[social-mention-ingest] provider fetch failed (${err?.message || 'unknown error'})`);
    return {
      attempted: true,
      available: false,
      source: 'provider',
      channel,
      fetchedCount: 0,
      messages: [],
      error: err?.message || 'provider_fetch_failed',
    };
  }
}

function fetchFromFile({ channel, feedPath, logger = console }) {
  if (!feedPath) {
    return {
      attempted: false,
      available: false,
      source: 'file',
      channel,
      fetchedCount: 0,
      messages: [],
      error: 'feed_path_not_configured',
    };
  }

  try {
    const raw = fs.readFileSync(feedPath, 'utf8');
    const parsed = JSON.parse(raw);
    const messages = Array.isArray(parsed)
      ? parsed
      : Array.isArray(parsed?.messages)
        ? parsed.messages
        : [];
    return {
      attempted: true,
      available: true,
      source: 'file',
      channel,
      fetchedCount: messages.length,
      messages,
      error: null,
    };
  } catch (err) {
    logger.warn?.(`[social-mention-ingest] feed file unavailable (${err?.message || 'unknown error'})`);
    return {
      attempted: true,
      available: false,
      source: 'file',
      channel,
      fetchedCount: 0,
      messages: [],
      error: err?.message || 'feed_file_unavailable',
    };
  }
}

async function fetchSocialMessages({
  channel,
  limit = 50,
  feedPath,
  listMessages,
  logger = console,
} = {}) {
  const providerResult = await fetchFromProvider({ channel, limit, listMessages, logger });
  if (providerResult.available) {
    return {
      ...providerResult,
      attempts: [providerResult],
    };
  }

  const fileResult = fetchFromFile({ channel, feedPath, logger });
  if (fileResult.available) {
    return {
      ...fileResult,
      attempts: [providerResult, fileResult].filter((attempt) => attempt.attempted),
      fallbackFrom: providerResult.attempted ? 'provider' : null,
    };
  }

  const attempts = [providerResult, fileResult].filter((attempt) => attempt.attempted);
  return {
    available: false,
    source: attempts[0]?.source || 'none',
    channel,
    fetchedCount: 0,
    messages: [],
    attempts,
    error: attempts.length
      ? attempts.map((attempt) => `${attempt.source}:${attempt.error}`).join(';')
      : 'no_feed_source_configured',
  };
}

function inferPriority(text) {
  const content = String(text || '').toLowerCase();
  if (/\b(p0|p1|critical|urgent|blocker|sev1)\b/.test(content)) return 'high';
  if (/\b(p2|important|soon)\b/.test(content)) return 'medium';
  if (/\b(p3|p4|low|backlog|whenever)\b/.test(content)) return 'low';
  return 'medium';
}

function extractAcceptanceCriteria(text) {
  const lines = String(text || '').split('\n').map((line) => line.trim());
  const marker = lines.findIndex((line) => /^acceptance criteria\s*:?/i.test(line));
  if (marker === -1) return [];

  const criteria = [];
  for (let i = marker + 1; i < lines.length; i += 1) {
    const line = lines[i];
    if (!line) continue;
    if (/^priority\s*:/i.test(line) || /^owner\s*:/i.test(line)) break;
    const bullet = line.match(/^[-*\d.)\s]+(.+)$/);
    if (bullet?.[1]) criteria.push(bullet[1].trim());
  }
  return criteria;
}

function extractOwner(text, mentions) {
  const ownerMatch = String(text || '').match(/owner\s*:\s*([@a-z0-9._-]+)/i);
  if (ownerMatch?.[1]) return ownerMatch[1].replace(/^@/, '').toLowerCase();
  if (Array.isArray(mentions) && mentions.length > 0) {
    return String(mentions[0]).replace(/^@/, '').toLowerCase();
  }
  return 'unassigned';
}

function extractTitle(text) {
  const first = String(text || '').split('\n').map((line) => line.trim()).find(Boolean) || 'Slack follow-up task';
  return first
    .replace(/^<@[A-Z0-9]+>\s*/i, '')
    .replace(/^@[a-z0-9._-]+\s*/i, '')
    .replace(/^(task|todo|please|can you|could you)\s*[:,-]?\s*/i, '')
    .trim();
}

function isActionableMessage(message) {
  const text = String(message?.text || '').toLowerCase();
  const hasActionVerb = /\b(build|implement|fix|add|create|design|investigate|ship|write|update)\b/.test(text);
  const hasTaskHint = /\b(task|todo|acceptance criteria|owner:|priority:)\b/.test(text);
  const directMention = Array.isArray(message?.mentions) && message.mentions.length > 0;
  return hasActionVerb || hasTaskHint || directMention;
}

function buildStructuredQueue(messages, { channel } = {}) {
  const normalized = (messages || []).map((message, idx) => normalizeMessage(message, idx, channel));
  return normalized.map((entry) => ({
    ...entry,
    actionable: isActionableMessage(entry),
    ingestionReason: isActionableMessage(entry) ? 'actionable_signal_detected' : 'no_action_signal',
  }));
}

function mapQueueToTaskPayloads(queue) {
  const seenMessageIds = new Set();
  const duplicateMessageIds = [];

  const taskPayloads = [];
  for (const entry of queue || []) {
    if (!entry?.actionable) continue;

    const messageId = String(entry.id || '').trim() || `missing-id-${taskPayloads.length + 1}`;
    if (seenMessageIds.has(messageId)) {
      duplicateMessageIds.push(messageId);
      continue;
    }
    seenMessageIds.add(messageId);

    taskPayloads.push({
      title: extractTitle(entry.text),
      owner: extractOwner(entry.text, entry.mentions),
      acceptanceCriteria: extractAcceptanceCriteria(entry.text),
      priority: inferPriority(entry.text),
      source: {
        type: 'slack-social-mention',
        messageId,
        channel: entry.channel,
        ts: entry.ts || null,
        mentionCount: entry.mentions.length,
      },
    });
  }

  return {
    taskPayloads,
    dedupe: {
      uniqueMessageCount: seenMessageIds.size,
      duplicateMessageIds: [...new Set(duplicateMessageIds)],
      duplicateCount: duplicateMessageIds.length,
    },
  };
}

function readKanbanBoard(kanbanPath) {
  const parsed = JSON.parse(fs.readFileSync(kanbanPath, 'utf8'));
  return {
    ...parsed,
    columns: {
      backlog: Array.isArray(parsed?.columns?.backlog) ? parsed.columns.backlog : [],
      todo: Array.isArray(parsed?.columns?.todo) ? parsed.columns.todo : [],
      inProgress: Array.isArray(parsed?.columns?.inProgress) ? parsed.columns.inProgress : [],
      done: Array.isArray(parsed?.columns?.done) ? parsed.columns.done : [],
    },
    activityLog: Array.isArray(parsed?.activityLog) ? parsed.activityLog : [],
  };
}

function enqueueTaskPayloadsToKanban({ taskPayloads, kanbanPath, logger = console, mode = process.env.OPSHUB_BOARD_MODE }) {
  if (!kanbanPath) {
    return { attempted: false, addedCount: 0, skippedDuplicateCount: 0, addedTaskIds: [], reason: 'kanban_path_not_configured' };
  }

  const board = readKanbanBoard(kanbanPath);
  const existingMessageIds = new Set();
  for (const col of ['backlog', 'todo', 'inProgress', 'done']) {
    for (const card of board.columns[col]) {
      const id = String(card?.sourceMessageId || '').trim();
      if (id) existingMessageIds.add(id);
    }
  }

  const now = new Date().toISOString();
  const boardMode = normalizeMode(mode);
  const addedTaskIds = [];
  let skippedDuplicateCount = 0;
  let blockedSyntheticCount = 0;

  const normalizedPayloadTasks = (taskPayloads || []).map((payload) => ({
    id: String(payload?.source?.messageId || payload?.title || `payload-${Date.now()}`),
    name: payload?.title || 'Slack follow-up task',
    description: Array.isArray(payload?.acceptanceCriteria) ? payload.acceptanceCriteria.join(' | ') : '',
    source: 'slack-social-mention',
    priority: payload?.priority || 'medium',
    _payload: payload
  }));

  const existingActiveTasks = [
    ...(Array.isArray(board?.columns?.todo) ? board.columns.todo : []),
    ...(Array.isArray(board?.columns?.inProgress) ? board.columns.inProgress : [])
  ];
  const guardrailed = prioritizeWithGuardrails(normalizedPayloadTasks, {
    syntheticCap: 2,
    strategicReserveShare: 0.3,
    nonStrategicCeiling: 0.7,
    existingActiveTasks,
  });

  for (const task of guardrailed.prioritized) {
    const payload = task._payload;
    const messageId = String(payload?.source?.messageId || '').trim();
    if (messageId && existingMessageIds.has(messageId)) {
      skippedDuplicateCount += 1;
      continue;
    }

    const taskId = `social-${messageId || Date.now().toString(36)}`;
    const criteria = Array.isArray(payload?.acceptanceCriteria) ? payload.acceptanceCriteria : [];
    const descriptionLines = [
      `Owner: ${payload?.owner || 'unassigned'}`,
      `Source message: ${messageId || 'unknown'}`,
      'Acceptance Criteria:',
      ...(criteria.length ? criteria.map((line) => `- ${line}`) : ['- follow up in Slack thread']),
    ];

    const writebackPriority = task?._guardrails?.priorityWriteback || mapScoreToPriority(task?._guardrails?.score || 0);
    const syntheticGuard = evaluateSyntheticWriteGuard({
      mode: boardMode,
      name: payload?.title || 'Slack follow-up task',
      description: descriptionLines.join('\n'),
      operation: 'script_social_mention_enqueue',
      path: 'scripts/social-mention-ingest.js#enqueueTaskPayloadsToKanban',
      source: 'slack-social-mention',
      taskId,
      logger,
    });
    if (!syntheticGuard.ok) {
      blockedSyntheticCount += 1;
      continue;
    }

    board.columns.todo.unshift({
      id: taskId,
      name: payload?.title || 'Slack follow-up task',
      description: descriptionLines.join('\n'),
      priority: writebackPriority,
      status: 'todo',
      source: 'slack-social-mention',
      sourceMessageId: messageId || null,
      createdAt: now,
      updatedAt: now,
      completedAt: null,
      startedAt: null,
    });

    board.activityLog.unshift({
      id: `activity-${taskId}`,
      taskId,
      type: 'task_created',
      from: null,
      to: 'todo',
      summary: `Queued from Slack social mention${messageId ? ` (${messageId})` : ''}`,
      at: now,
    });

    addedTaskIds.push(taskId);
    if (messageId) existingMessageIds.add(messageId);
  }

  const quarantinedTaskIds = [];
  for (const task of guardrailed.quarantined) {
    const payload = task._payload;
    const messageId = String(payload?.source?.messageId || '').trim() || null;
    const quarantineId = `quarantine-social-${messageId || Date.now().toString(36)}`;
    const quarantineReason = task?._quarantineReason || 'synthetic_cap_exceeded';
    board.columns.backlog.unshift({
      id: quarantineId,
      name: `[Quarantine] ${payload?.title || 'Synthetic social task'}`,
      description: `Auto-quarantined by PantryPal priority guardrails (${quarantineReason}).`,
      priority: 'low',
      status: 'backlog',
      source: 'pantrypal-priority-guardrails',
      sourceMessageId: messageId,
      createdAt: now,
      updatedAt: now,
      completedAt: null,
      startedAt: null
    });
    quarantinedTaskIds.push(quarantineId);
  }

  fs.writeFileSync(kanbanPath, `${JSON.stringify(board, null, 2)}\n`);
  logger.info?.(`[social-mention-ingest] enqueued ${addedTaskIds.length} task(s) to kanban; quarantined ${quarantinedTaskIds.length}; blockedSynthetic ${blockedSyntheticCount}`);

  return {
    attempted: true,
    mode: boardMode,
    addedCount: addedTaskIds.length,
    skippedDuplicateCount,
    blockedSyntheticCount,
    addedTaskIds,
    quarantinedCount: quarantinedTaskIds.length,
    quarantinedTaskIds,
    reason: null,
  };
}

async function ingestSocialMentions(options = {}) {
  const {
    channel = 'social',
    limit = 50,
    feedPath,
    queueOut,
    tasksOut,
    diagnosticsOut,
    listMessages,
    enqueueToKanban = false,
    kanbanPath,
    logger = console,
  } = options;

  const feed = await fetchSocialMessages({ channel, limit, feedPath, listMessages, logger });
  const queue = buildStructuredQueue(feed.messages, { channel });
  const mapped = mapQueueToTaskPayloads(queue);
  const taskPayloads = mapped.taskPayloads;
  const enqueueResult = enqueueToKanban
    ? enqueueTaskPayloadsToKanban({ taskPayloads, kanbanPath, logger })
    : { attempted: false, addedCount: 0, skippedDuplicateCount: 0, addedTaskIds: [], reason: 'enqueue_disabled' };

  const diagnostics = {
    ok: feed.available,
    channel,
    source: feed.source,
    fetchedCount: feed.fetchedCount,
    actionableCount: taskPayloads.length,
    dedupe: mapped.dedupe,
    fallbackApplied: !feed.available || Boolean(feed.fallbackFrom),
    fallbackFrom: feed.fallbackFrom || null,
    reason: feed.available ? 'feed_available' : (feed.error || 'feed_unavailable'),
    fetchAttempts: Array.isArray(feed.attempts)
      ? feed.attempts.map((attempt) => ({
        source: attempt.source,
        attempted: attempt.attempted,
        available: attempt.available,
        fetchedCount: attempt.fetchedCount,
        error: attempt.error || null,
      }))
      : [],
    enqueue: enqueueResult,
    generatedAt: new Date().toISOString(),
  };

  if (queueOut) fs.writeFileSync(queueOut, `${JSON.stringify({ queue }, null, 2)}\n`);
  if (tasksOut) fs.writeFileSync(tasksOut, `${JSON.stringify({ taskPayloads }, null, 2)}\n`);
  if (diagnosticsOut) fs.writeFileSync(diagnosticsOut, `${JSON.stringify(diagnostics, null, 2)}\n`);

  return { diagnostics, queue, taskPayloads, enqueueResult };
}

function parseArgs(argv) {
  const args = {};
  for (const arg of argv.slice(2)) {
    const match = arg.match(/^--([a-z0-9-]+)=(.+)$/i);
    if (match) args[match[1]] = match[2];
    else if (arg.startsWith('--')) args[arg.slice(2)] = true;
  }
  return args;
}

function resolveListMessagesProvider({ providerModulePath, providerExport = 'listMessages', logger = console } = {}) {
  if (!providerModulePath) return null;

  try {
    const fullPath = path.isAbsolute(providerModulePath)
      ? providerModulePath
      : path.resolve(process.cwd(), providerModulePath);
    const loaded = require(fullPath);
    if (typeof loaded === 'function') return loaded;
    if (typeof loaded?.[providerExport] === 'function') return loaded[providerExport];
    logger.warn?.(`[social-mention-ingest] provider module missing function export "${providerExport}" (${fullPath})`);
  } catch (err) {
    logger.warn?.(`[social-mention-ingest] failed to load provider module (${err?.message || 'unknown error'})`);
  }
  return null;
}

async function runCli() {
  const args = parseArgs(process.argv);
  const root = path.resolve(__dirname, '..');

  const queueOut = args['queue-out'] || path.join(root, 'artifacts', 'social-mention-queue.json');
  const tasksOut = args['tasks-out'] || path.join(root, 'artifacts', 'social-mention-task-payloads.json');
  const diagnosticsOut = args['diagnostics-out'] || path.join(root, 'artifacts', 'social-mention-diagnostics.json');

  const providerModulePath = args['provider-module'] || process.env.OPSHUB_SOCIAL_PROVIDER_MODULE;
  const providerExport = args['provider-export'] || process.env.OPSHUB_SOCIAL_PROVIDER_EXPORT || 'listMessages';
  const listMessages = resolveListMessagesProvider({ providerModulePath, providerExport });

  const result = await ingestSocialMentions({
    channel: args.channel || 'social-progress',
    limit: Number.parseInt(args.limit || '50', 10),
    feedPath: args['feed-path'],
    queueOut,
    tasksOut,
    diagnosticsOut,
    listMessages,
    enqueueToKanban: Boolean(args['enqueue-to-kanban']),
    kanbanPath: args['kanban-path'] || path.join(root, 'data', 'kanban.json'),
  });

  console.log(JSON.stringify({
    diagnostics: result.diagnostics,
    artifacts: {
      queueOut,
      tasksOut,
      diagnosticsOut,
    },
  }, null, 2));
}

if (require.main === module) {
  runCli().catch((error) => {
    console.error(error?.stack || String(error));
    process.exit(1);
  });
}

module.exports = {
  fetchSocialMessages,
  buildStructuredQueue,
  mapQueueToTaskPayloads,
  ingestSocialMentions,
  isActionableMessage,
  extractAcceptanceCriteria,
  extractOwner,
  extractTitle,
  inferPriority,
  resolveListMessagesProvider,
  enqueueTaskPayloadsToKanban,
};
