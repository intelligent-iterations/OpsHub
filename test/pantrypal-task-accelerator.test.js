const test = require('node:test');
const assert = require('node:assert/strict');

const {
  toSlug,
  createAcceptanceCriteria,
  deriveBlockedReasons,
  buildTaskQueue,
  isQueueLight,
  createLightQueueSeedTasks,
  createAdaptiveSeedTasks,
  buildQueueWithAutoSeed,
  createQueueHealthSnapshot,
  pickImmediateExecution,
  runValidationCommand,
  formatTaskMarkdown,
  formatTaskJson
} = require('../scripts/pantrypal-task-accelerator');

test('toSlug normalizes experiment names', () => {
  assert.equal(toSlug('Expiry-risk push digest!'), 'expiry-risk-push-digest');
});

test('createAcceptanceCriteria includes metric, target lift, sample gate, and validation command', () => {
  const criteria = createAcceptanceCriteria({
    primaryMetric: 'activation rate',
    targetLiftPct: 10,
    minimumSampleSize: 2000,
    experimentWindowDays: 21,
    guardrail: 'crash-free sessions remain >=99.5%',
    validationCommand: 'npm test -- growth'
  });

  assert.equal(criteria.length, 6);
  assert.match(criteria[0], /activation rate/);
  assert.equal(criteria[1], 'A/B test is configured with event instrumentation and minimum detectable lift target of 10%.');
  assert.match(criteria[2], /2000 qualified households/);
  assert.match(criteria[2], /21 days/);
  assert.match(criteria[3], /99.5%/);
  assert.match(criteria[4], /npm test -- growth/);
});

test('deriveBlockedReasons maps external dependencies', () => {
  const reasons = deriveBlockedReasons({ externalDependency: ['data pipeline approval', 'legal copy sign-off'] });
  assert.deepEqual(reasons, [
    'External dependency: data pipeline approval',
    'External dependency: legal copy sign-off'
  ]);
});

test('buildTaskQueue ranks experiments and emits stable ids', () => {
  const queue = buildTaskQueue([
    { name: 'Lower score', impact: 0.4, confidence: 0.5, ease: 0.5, pantryPalFit: 0.5 },
    { name: 'Higher score', impact: 0.9, confidence: 0.9, ease: 0.8, pantryPalFit: 0.9 }
  ], { defaultOwner: 'qa-owner', limit: 1 });

  assert.equal(queue.length, 1);
  assert.equal(queue[0].owner, 'qa-owner');
  assert.match(queue[0].id, /^PP-GROWTH-001-higher-score$/);
  assert.equal(queue[0].validationCommand, 'npm test');
});

test('buildTaskQueue supports minimumScore filtering', () => {
  const queue = buildTaskQueue([
    { name: 'Low score', impact: 0.5, confidence: 0.5, ease: 0.5, pantryPalFit: 0.5 },
    { name: 'High score', impact: 0.95, confidence: 0.9, ease: 0.8, pantryPalFit: 0.9 }
  ], { minimumScore: 80, limit: 3 });

  assert.equal(queue.length, 1);
  assert.match(queue[0].title, /High score/);
});

test('isQueueLight applies default threshold', () => {
  assert.equal(isQueueLight([{ id: 'one' }, { id: 'two' }]), true);
  assert.equal(isQueueLight([{ id: 'one' }, { id: 'two' }, { id: 'three' }]), false);
});


test('createLightQueueSeedTasks returns pantrypal-ready tasks with acceptance inputs', () => {
  const seeds = createLightQueueSeedTasks({ validationCommand: 'npm test -- pantrypal' });
  assert.equal(seeds.length, 2);
  assert.match(seeds[0].name, /lapsed households/i);
  assert.equal(seeds[0].minimumSampleSize, 1600);
  assert.equal(seeds[0].experimentWindowDays, 14);
  assert.equal(seeds[0].validationCommand, 'npm test -- pantrypal');
});


test('createAdaptiveSeedTasks skips duplicates and respects maxTasks', () => {
  const experiments = [{ name: 'Rescue streak comeback experiment for lapsed households' }];
  const seeds = createAdaptiveSeedTasks(experiments, { maxTasks: 2, validationCommand: 'npm test -- smoke' });

  assert.equal(seeds.length, 2);
  assert.equal(seeds[0].name, 'Smart defrost reminder timing tuned by prep-time tier');
  assert.equal(seeds[1].name, 'Win-back pantry scan streak with 2-minute rescue plan teaser');
  assert.equal(seeds[0].validationCommand, 'npm test -- smoke');
});

test('buildQueueWithAutoSeed seeds when minimumScore leaves queue light', () => {
  const experiments = [
    { name: 'Okay', impact: 0.7, confidence: 0.65, ease: 0.6, pantryPalFit: 0.8 }
  ];

  const { queue, seeded } = buildQueueWithAutoSeed(experiments, {
    minimumScore: 85,
    limit: 3,
    lightThreshold: 2,
    defaultOwner: 'growth-oncall'
  });

  assert.equal(seeded, true);
  assert.ok(queue.length >= 1);
});


test('buildQueueWithAutoSeed backfills to meet requested limit when queue is light', () => {
  const experiments = [
    { name: 'Strong baseline', impact: 0.88, confidence: 0.82, ease: 0.8, pantryPalFit: 0.94 }
  ];

  const { queue, seeded } = buildQueueWithAutoSeed(experiments, {
    minimumScore: 70,
    limit: 4,
    lightThreshold: 2,
    defaultOwner: 'growth-oncall',
    validationCommand: 'npm test -- smoke'
  });

  assert.equal(seeded, true);
  assert.equal(queue.length, 4);
  assert.ok(queue.every((task) => task.owner === 'growth-oncall'));
});

test('createQueueHealthSnapshot reports light queue, readiness, and minimum score eligibility', () => {
  const experiments = [
    { name: 'Strong', impact: 0.9, confidence: 0.8, ease: 0.8, pantryPalFit: 0.9, externalDependency: 'legal sign-off' },
    { name: 'Weak', impact: 0.5, confidence: 0.5, ease: 0.5, pantryPalFit: 0.5 }
  ];
  const queue = buildTaskQueue(experiments, { minimumScore: 60, limit: 3 });
  const health = createQueueHealthSnapshot(experiments, queue, { minimumScore: 60, lightThreshold: 2 });

  assert.equal(health.incomingExperiments, 2);
  assert.equal(health.eligibleExperiments, 1);
  assert.equal(health.queueSize, 1);
  assert.equal(health.readyTasks, 0);
  assert.equal(health.blockedTasks, 1);
  assert.equal(health.isLight, true);
  assert.equal(health.threshold, 2);
  assert.equal(health.minimumScore, 60);
});

test('pickImmediateExecution chooses top queue item and includes acceptance checklist gating + validation step', () => {
  const plan = pickImmediateExecution([{
    id: 'PP-GROWTH-001-foo',
    title: 'Foo',
    score: 90,
    acceptanceCriteria: ['criterion 1', 'criterion 2', 'criterion 3', 'criterion 4'],
    validationCommand: 'npm test -- foo'
  }]);

  assert.equal(plan.taskId, 'PP-GROWTH-001-foo');
  assert.equal(plan.acceptanceChecklist.length, 3);
  assert.equal(plan.executionNow.length, 5);
  assert.equal(plan.validationCommand, 'npm test -- foo');
  assert.match(plan.executionNow[2], /critical checks/);
  assert.match(plan.executionNow[3], /npm test -- foo/);
});

test('pickImmediateExecution skips blocked tasks', () => {
  const plan = pickImmediateExecution([
    {
      id: 'PP-GROWTH-001-blocked',
      title: 'Blocked',
      isReady: false,
      blockedReasons: ['External dependency: legal sign-off'],
      acceptanceCriteria: ['c1'],
      validationCommand: 'npm test -- blocked'
    },
    {
      id: 'PP-GROWTH-002-ready',
      title: 'Ready',
      isReady: true,
      blockedReasons: [],
      acceptanceCriteria: ['c1', 'c2', 'c3'],
      validationCommand: 'npm test -- ready'
    }
  ]);

  assert.equal(plan.taskId, 'PP-GROWTH-002-ready');
  assert.equal(plan.validationCommand, 'npm test -- ready');
});

test('runValidationCommand returns PASS with output snippet', () => {
  const result = runValidationCommand('npm test -- smoke', {
    runner: () => 'line1\nline2\nline3'
  });

  assert.equal(result.status, 'PASS');
  assert.equal(result.exitCode, 0);
  assert.equal(result.command, 'npm test -- smoke');
  assert.match(result.outputSnippet, /line3/);
});

test('runValidationCommand returns FAIL when runner throws', () => {
  const error = new Error('boom');
  error.status = 2;
  error.stdout = 'stdout-line';
  error.stderr = 'stderr-line';

  const result = runValidationCommand('npm test -- fail', {
    runner: () => {
      throw error;
    }
  });

  assert.equal(result.status, 'FAIL');
  assert.equal(result.exitCode, 2);
  assert.match(result.outputSnippet, /stderr-line/);
});

test('pickImmediateExecution returns blocked queue summary when no ready tasks', () => {
  const plan = pickImmediateExecution([
    {
      id: 'PP-GROWTH-001-blocked',
      title: 'Blocked',
      isReady: false,
      blockedReasons: ['External dependency: legal sign-off'],
      acceptanceCriteria: ['c1'],
      validationCommand: 'npm test -- blocked'
    },
    {
      id: 'PP-GROWTH-002-blocked',
      title: 'Blocked too',
      isReady: false,
      blockedReasons: ['External dependency: legal sign-off', 'External dependency: data approval'],
      acceptanceCriteria: ['c1'],
      validationCommand: 'npm test -- blocked2'
    }
  ]);

  assert.equal(plan.blockedQueue, true);
  assert.equal(plan.taskId, null);
  assert.equal(plan.blockedReasons.length, 2);
  assert.match(plan.blockedReasons[0], /legal sign-off/);
});

test('formatTaskMarkdown renders queue execution and validation section', () => {
  const markdown = formatTaskMarkdown(
    [{ id: 'PP-GROWTH-001-foo', title: 'Foo', score: 91.23, owner: 'growth', acceptanceCriteria: ['a', 'b'] }],
    { taskId: 'PP-GROWTH-001-foo', title: 'Foo', acceptanceChecklist: ['c1'], executionNow: ['step1'] },
    { status: 'PASS', command: 'npm test', exitCode: 0, durationMs: 1234, outputSnippet: 'ok' },
    { incomingExperiments: 3, eligibleExperiments: 2, queueSize: 1, readyTasks: 1, blockedTasks: 0, isLight: true, threshold: 2 }
  );

  assert.match(markdown, /PantryPal Task Queue/);
  assert.match(markdown, /PP-GROWTH-001-foo/);
  assert.match(markdown, /Queue Health/);
  assert.match(markdown, /Ready tasks: 1/);
  assert.match(markdown, /Blocked tasks: 0/);
  assert.match(markdown, /Execute Immediately/);
  assert.match(markdown, /Critical Acceptance Checklist/);
  assert.match(markdown, /Launch Steps/);
  assert.match(markdown, /Validation Result/);
  assert.match(markdown, /Status: PASS/);
});

test('formatTaskJson emits seeded metadata and validation payload', () => {
  const json = formatTaskJson(
    [{ id: 'PP-GROWTH-001-foo', title: 'Foo', score: 91.23, owner: 'growth', acceptanceCriteria: [] }],
    { taskId: 'PP-GROWTH-001-foo', title: 'Foo', acceptanceChecklist: ['c1'], executionNow: ['step1'] },
    { status: 'PASS', command: 'npm test', exitCode: 0, durationMs: 20, outputSnippet: 'ok' },
    { seeded: true, generatedAt: '2026-02-28T01:56:00.000Z' },
    { incomingExperiments: 4, eligibleExperiments: 3, queueSize: 1, isLight: true, threshold: 2 }
  );

  const parsed = JSON.parse(json);
  assert.equal(parsed.seeded, true);
  assert.equal(parsed.generatedAt, '2026-02-28T01:56:00.000Z');
  assert.equal(parsed.health.eligibleExperiments, 3);
  assert.equal(parsed.queue.length, 1);
  assert.equal(parsed.immediateExecution.taskId, 'PP-GROWTH-001-foo');
  assert.equal(parsed.validation.status, 'PASS');
});