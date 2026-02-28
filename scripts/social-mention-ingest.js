#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

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

async function fetchSocialMessages({
  channel,
  limit = 50,
  feedPath,
  listMessages,
  logger = console,
} = {}) {
  if (typeof listMessages === 'function') {
    try {
      const items = await listMessages({ channel, limit });
      const messages = Array.isArray(items) ? items : [];
      return {
        available: true,
        source: 'provider',
        channel,
        fetchedCount: messages.length,
        messages,
      };
    } catch (err) {
      logger.warn?.(`[social-mention-ingest] provider fetch failed (${err?.message || 'unknown error'})`);
      return {
        available: false,
        source: 'provider',
        channel,
        fetchedCount: 0,
        messages: [],
        error: err?.message || 'provider_fetch_failed',
      };
    }
  }

  if (feedPath) {
    try {
      const raw = fs.readFileSync(feedPath, 'utf8');
      const parsed = JSON.parse(raw);
      const messages = Array.isArray(parsed)
        ? parsed
        : Array.isArray(parsed?.messages)
          ? parsed.messages
          : [];
      return {
        available: true,
        source: 'file',
        channel,
        fetchedCount: messages.length,
        messages,
      };
    } catch (err) {
      logger.warn?.(`[social-mention-ingest] feed file unavailable (${err?.message || 'unknown error'})`);
      return {
        available: false,
        source: 'file',
        channel,
        fetchedCount: 0,
        messages: [],
        error: err?.message || 'feed_file_unavailable',
      };
    }
  }

  return {
    available: false,
    source: 'none',
    channel,
    fetchedCount: 0,
    messages: [],
    error: 'no_feed_source_configured',
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
  return (queue || [])
    .filter((entry) => entry.actionable)
    .map((entry) => ({
      title: extractTitle(entry.text),
      owner: extractOwner(entry.text, entry.mentions),
      acceptanceCriteria: extractAcceptanceCriteria(entry.text),
      priority: inferPriority(entry.text),
      source: {
        type: 'slack-social-mention',
        messageId: entry.id,
        channel: entry.channel,
        ts: entry.ts || null,
        mentionCount: entry.mentions.length,
      },
    }));
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
    logger = console,
  } = options;

  const feed = await fetchSocialMessages({ channel, limit, feedPath, listMessages, logger });
  const queue = buildStructuredQueue(feed.messages, { channel });
  const taskPayloads = mapQueueToTaskPayloads(queue);

  const diagnostics = {
    ok: feed.available,
    channel,
    source: feed.source,
    fetchedCount: feed.fetchedCount,
    actionableCount: taskPayloads.length,
    fallbackApplied: !feed.available,
    reason: feed.available ? 'feed_available' : (feed.error || 'feed_unavailable'),
    generatedAt: new Date().toISOString(),
  };

  if (queueOut) fs.writeFileSync(queueOut, `${JSON.stringify({ queue }, null, 2)}\n`);
  if (tasksOut) fs.writeFileSync(tasksOut, `${JSON.stringify({ taskPayloads }, null, 2)}\n`);
  if (diagnosticsOut) fs.writeFileSync(diagnosticsOut, `${JSON.stringify(diagnostics, null, 2)}\n`);

  return { diagnostics, queue, taskPayloads };
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

async function runCli() {
  const args = parseArgs(process.argv);
  const root = path.resolve(__dirname, '..');

  const queueOut = args['queue-out'] || path.join(root, 'artifacts', 'social-mention-queue.json');
  const tasksOut = args['tasks-out'] || path.join(root, 'artifacts', 'social-mention-task-payloads.json');
  const diagnosticsOut = args['diagnostics-out'] || path.join(root, 'artifacts', 'social-mention-diagnostics.json');

  const result = await ingestSocialMentions({
    channel: args.channel || 'social-progress',
    limit: Number.parseInt(args.limit || '50', 10),
    feedPath: args['feed-path'],
    queueOut,
    tasksOut,
    diagnosticsOut,
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
};
