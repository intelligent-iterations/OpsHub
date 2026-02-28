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
} = require('../scripts/social-mention-ingest');

test('fetchSocialMessages returns fallback diagnostics when no source is configured', async () => {
  const result = await fetchSocialMessages({ channel: 'social-progress' });
  assert.equal(result.available, false);
  assert.equal(result.error, 'no_feed_source_configured');
  assert.equal(result.messages.length, 0);
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

test('mapQueueToTaskPayloads extracts title/owner/acceptance criteria/priority', () => {
  const payloads = mapQueueToTaskPayloads([
    {
      id: 'm1',
      ts: '1700000000.111',
      channel: 'social-progress',
      text: 'Task: Build Slack bridge for social cron\nOwner: @claw\nAcceptance Criteria:\n- read social channel mentions\n- emit OpsHub task payload\nPriority: critical',
      mentions: ['claw'],
      actionable: true,
    },
  ]);

  assert.equal(payloads.length, 1);
  assert.equal(payloads[0].title, 'Build Slack bridge for social cron');
  assert.equal(payloads[0].owner, 'claw');
  assert.deepEqual(payloads[0].acceptanceCriteria, [
    'read social channel mentions',
    'emit OpsHub task payload',
  ]);
  assert.equal(payloads[0].priority, 'high');
});

test('ingestSocialMentions writes queue/tasks/diagnostics artifacts and supports feed file', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'social-mention-ingest-'));
  const feedPath = join(dir, 'feed.json');
  const queueOut = join(dir, 'queue.json');
  const tasksOut = join(dir, 'tasks.json');
  const diagnosticsOut = join(dir, 'diag.json');

  try {
    await writeFile(feedPath, JSON.stringify({
      messages: [
        {
          id: 's1',
          user: 'analyst',
          text: '@claw fix social feed fallback\nAcceptance Criteria:\n- add diagnostics',
          channel: 'social-progress',
        },
      ],
    }), 'utf8');

    const result = await ingestSocialMentions({
      channel: 'social-progress',
      feedPath,
      queueOut,
      tasksOut,
      diagnosticsOut,
    });

    assert.equal(result.diagnostics.ok, true);
    assert.equal(result.diagnostics.fallbackApplied, false);
    assert.equal(result.taskPayloads.length, 1);

    const queueArtifact = JSON.parse(await readFile(queueOut, 'utf8'));
    const taskArtifact = JSON.parse(await readFile(tasksOut, 'utf8'));
    const diagnosticsArtifact = JSON.parse(await readFile(diagnosticsOut, 'utf8'));

    assert.equal(Array.isArray(queueArtifact.queue), true);
    assert.equal(Array.isArray(taskArtifact.taskPayloads), true);
    assert.equal(diagnosticsArtifact.ok, true);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
