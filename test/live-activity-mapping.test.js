const test = require('node:test');
const assert = require('node:assert/strict');

const { buildLiveAgentActivity, deriveAgentLabel } = require('../lib/openclaw-live-activity');

test('deriveAgentLabel extracts agent identity from session key', () => {
  assert.equal(deriveAgentLabel('agent:vibe-coder:subagent:abc123'), 'vibe-coder');
  assert.equal(deriveAgentLabel('agent:opsmanager:main'), 'main');
  assert.equal(deriveAgentLabel(''), 'unknown-agent');
});

test('buildLiveAgentActivity maps session telemetry to in-progress kanban tasks', () => {
  const board = {
    columns: {
      backlog: [],
      todo: [],
      inProgress: [
        {
          id: 'task-1',
          name: 'Implement telemetry API endpoint',
          description: 'Add endpoint for live activity',
          status: 'inProgress'
        }
      ],
      done: []
    }
  };

  const sessions = [
    {
      key: 'agent:vibe-coder:subagent:task-1',
      lastUserMessage: 'Implement telemetry API endpoint and wire dashboard panel',
      status: 'active',
      updatedAt: '2026-02-28T20:00:00.000Z'
    }
  ];

  const runs = [
    {
      id: 'run-9',
      sessionKey: 'agent:vibe-coder:subagent:task-1',
      task: 'Implement telemetry API endpoint',
      state: 'running',
      updatedAt: '2026-02-28T20:00:10.000Z'
    }
  ];

  const result = buildLiveAgentActivity({
    board,
    sessions,
    runs,
    now: new Date('2026-02-28T20:01:00.000Z')
  });

  assert.equal(result.counts.sessions, 1);
  assert.equal(result.counts.runs, 1);
  assert.equal(result.counts.mappedTasks, 1);
  assert.equal(result.items.length, 1);
  assert.equal(result.items[0].agent, 'vibe-coder');
  assert.equal(result.items[0].currentTaskSession, 'Implement telemetry API endpoint');
  assert.equal(result.items[0].state, 'running');
  assert.equal(result.items[0].mappedTaskId, 'task-1');
  assert.equal(result.items[0].mappingConfidence, 'high');
});
