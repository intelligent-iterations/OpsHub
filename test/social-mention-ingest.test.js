const test = require('node:test');
const assert = require('node:assert/strict');
const { mkdtemp, writeFile, readFile, rm } = require('node:fs/promises');
const { join } = require('node:path');
const { tmpdir } = require('node:os');

const {
  fetchSocialMessages,
  buildStructuredQueue,
  mapQueueToTaskPayloads,
  ingestSocialMentions,
  resolveListMessagesProvider,
  enqueueTaskPayloadsToKanban,
} = require('../scripts/social-mention-ingest');

test('fetchSocialMessages returns fallback diagnostics when no source is configured', async () => {
  const result = await fetchSocialMessages({ channel: 'social-progress' });
  assert.equal(result.available, false);
  assert.equal(result.error, 'no_feed_source_configured');
  assert.equal(result.messages.length, 0);
});

test('ingestSocialMentions emits fallback diagnostics when provider and file are unavailable', async () => {
  const result = await ingestSocialMentions({
    channel: 'social-progress',
    listMessages: async () => {
      throw new Error('slack api unavailable');
    },
    feedPath: '/tmp/does-not-exist-social-feed.json',
  });

  assert.equal(result.diagnostics.ok, false);
  assert.equal(result.diagnostics.fallbackApplied, true);
  assert.equal(result.diagnostics.actionableCount, 0);
  assert.equal(result.taskPayloads.length, 0);
  assert.equal(result.diagnostics.fetchAttempts.length, 2);
  assert.equal(result.diagnostics.fetchAttempts[0].source, 'provider');
  assert.equal(result.diagnostics.fetchAttempts[1].source, 'file');
});

test('fetchSocialMessages prefers live provider and records source', async () => {
  const result = await fetchSocialMessages({
    channel: 'social-progress',
    listMessages: async () => ([{ id: 'p1', text: '@claw implement bridge' }]),
  });

  assert.equal(result.available, true);
  assert.equal(result.source, 'provider');
  assert.equal(result.messages.length, 1);
});

test('fetchSocialMessages falls back to file when provider fails', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'social-mention-ingest-provider-fallback-'));
  const feedPath = join(dir, 'feed.json');

  try {
    await writeFile(feedPath, JSON.stringify({ messages: [{ id: 'f1', text: 'Task: from file' }] }), 'utf8');

    const result = await fetchSocialMessages({
      channel: 'social-progress',
      feedPath,
      listMessages: async () => {
        throw new Error('provider offline');
      },
    });

    assert.equal(result.available, true);
    assert.equal(result.source, 'file');
    assert.equal(result.fallbackFrom, 'provider');
    assert.equal(result.messages.length, 1);
    assert.equal(result.attempts.length, 2);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('buildStructuredQueue normalizes mentions and marks actionable content', () => {
  const queue = buildStructuredQueue([
    {
      id: '1',
      channel: 'social-progress',
      user: 'reporter',
      text: '@claw please implement Slack social bridge\nAcceptance Criteria:\n- fetch mentions\n- map tasks\nPriority: high',
    },
    {
      id: '2',
      channel: 'social-progress',
      user: 'observer',
      text: 'just chatting about dinner',
    },
  ], { channel: 'social-progress' });

  assert.equal(queue.length, 2);
  assert.equal(queue[0].actionable, true);
  assert.deepEqual(queue[0].mentions, ['claw']);
  assert.equal(queue[1].actionable, false);
});

test('mapQueueToTaskPayloads extracts fields and dedupes by source message id', () => {
  const mapped = mapQueueToTaskPayloads([
    {
      id: 'm1',
      ts: '1700000000.111',
      channel: 'social-progress',
      text: 'Task: Build Slack bridge for social cron\nOwner: @claw\nAcceptance Criteria:\n- read social channel mentions\n- emit OpsHub task payload\nPriority: critical',
      mentions: ['claw'],
      actionable: true,
    },
    {
      id: 'm1',
      ts: '1700000000.111',
      channel: 'social-progress',
      text: 'Task: duplicate should be ignored',
      mentions: ['claw'],
      actionable: true,
    },
  ]);

  assert.equal(mapped.taskPayloads.length, 1);
  assert.equal(mapped.taskPayloads[0].title, 'Build Slack bridge for social cron');
  assert.equal(mapped.taskPayloads[0].owner, 'claw');
  assert.deepEqual(mapped.taskPayloads[0].acceptanceCriteria, [
    'read social channel mentions',
    'emit OpsHub task payload',
  ]);
  assert.equal(mapped.taskPayloads[0].priority, 'high');
  assert.equal(mapped.dedupe.duplicateCount, 1);
  assert.deepEqual(mapped.dedupe.duplicateMessageIds, ['m1']);
});

test('ingestSocialMentions writes queue/tasks/diagnostics artifacts and supports provider path', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'social-mention-ingest-'));
  const queueOut = join(dir, 'queue.json');
  const tasksOut = join(dir, 'tasks.json');
  const diagnosticsOut = join(dir, 'diag.json');

  try {
    const result = await ingestSocialMentions({
      channel: 'social-progress',
      listMessages: async () => ([
        {
          id: 's1',
          user: 'analyst',
          text: '@claw fix social feed fallback\nAcceptance Criteria:\n- add diagnostics',
          channel: 'social-progress',
        },
        {
          id: 's1',
          user: 'analyst',
          text: '@claw duplicate message id',
          channel: 'social-progress',
        },
      ]),
      queueOut,
      tasksOut,
      diagnosticsOut,
    });

    assert.equal(result.diagnostics.ok, true);
    assert.equal(result.diagnostics.source, 'provider');
    assert.equal(result.diagnostics.fallbackApplied, false);
    assert.equal(result.taskPayloads.length, 1);
    assert.equal(result.diagnostics.dedupe.duplicateCount, 1);

    const queueArtifact = JSON.parse(await readFile(queueOut, 'utf8'));
    const taskArtifact = JSON.parse(await readFile(tasksOut, 'utf8'));
    const diagnosticsArtifact = JSON.parse(await readFile(diagnosticsOut, 'utf8'));

    assert.equal(Array.isArray(queueArtifact.queue), true);
    assert.equal(Array.isArray(taskArtifact.taskPayloads), true);
    assert.equal(diagnosticsArtifact.ok, true);
    assert.equal(diagnosticsArtifact.source, 'provider');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('resolveListMessagesProvider loads exported function from module path', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'social-provider-module-'));
  const providerPath = join(dir, 'provider.js');
  try {
    await writeFile(
      providerPath,
      'module.exports = { listMessages: async () => ([{ id: "m-provider", text: "Task: hello" }]) };\n',
      'utf8'
    );

    const listMessages = resolveListMessagesProvider({ providerModulePath: providerPath });
    assert.equal(typeof listMessages, 'function');
    const messages = await listMessages({ channel: 'social-progress', limit: 1 });
    assert.equal(Array.isArray(messages), true);
    assert.equal(messages[0].id, 'm-provider');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('enqueueTaskPayloadsToKanban adds todo cards and skips existing source message ids', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'social-mention-kanban-enqueue-'));
  const kanbanPath = join(dir, 'kanban.json');
  try {
    await writeFile(kanbanPath, JSON.stringify({ columns: { backlog: [], todo: [], inProgress: [], done: [] }, activityLog: [] }, null, 2), 'utf8');

    const first = enqueueTaskPayloadsToKanban({
      kanbanPath,
      taskPayloads: [{
        title: 'Build social queue bridge',
        owner: 'claw',
        acceptanceCriteria: ['read mentions', 'queue task'],
        priority: 'high',
        source: { messageId: 'm-1' },
      }],
      logger: { info: () => {} },
    });
    assert.equal(first.addedCount, 1);
    assert.equal(first.quarantinedCount, 0);

    const second = enqueueTaskPayloadsToKanban({
      kanbanPath,
      taskPayloads: [{
        title: 'Duplicate should skip',
        owner: 'claw',
        acceptanceCriteria: ['noop'],
        priority: 'medium',
        source: { messageId: 'm-1' },
      }],
      logger: { info: () => {} },
    });
    assert.equal(second.addedCount, 0);
    assert.equal(second.skippedDuplicateCount, 1);

    const board = JSON.parse(await readFile(kanbanPath, 'utf8'));
    assert.equal(board.columns.todo.length, 1);
    assert.equal(board.columns.todo[0].sourceMessageId, 'm-1');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('enqueueTaskPayloadsToKanban quarantines synthetic churn overflow beyond cap', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'social-mention-kanban-quarantine-'));
  const kanbanPath = join(dir, 'kanban.json');
  try {
    await writeFile(kanbanPath, JSON.stringify({ columns: { backlog: [], todo: [], inProgress: [], done: [] }, activityLog: [] }, null, 2), 'utf8');

    const result = enqueueTaskPayloadsToKanban({
      kanbanPath,
      taskPayloads: [
        { title: 'Smoke lifecycle run 1', priority: 'high', source: { messageId: 's-1' } },
        { title: 'Smoke lifecycle run 2', priority: 'high', source: { messageId: 's-2' } },
        { title: 'Smoke lifecycle run 3', priority: 'high', source: { messageId: 's-3' } },
        { title: 'PantryPal rescue optimization', priority: 'medium', source: { messageId: 'p-1' } }
      ],
      logger: { info: () => {} },
    });

    assert.equal(result.addedCount, 3);
    assert.equal(result.quarantinedCount, 1);

    const board = JSON.parse(await readFile(kanbanPath, 'utf8'));
    assert.equal(board.columns.todo.some((t) => String(t.name).includes('PantryPal rescue optimization')), true);
    assert.equal(board.columns.backlog.some((t) => String(t.name).startsWith('[Quarantine]')), true);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
