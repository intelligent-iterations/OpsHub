const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');

const {
  toSlug,
  createAcceptanceCriteria,
  deriveBlockedReasons,
  buildTaskQueue,
  isQueueLight,
  countReadyTasks,
  isExecutionCapacityLight,
  createLightQueueSeedTasks,
  createAdaptiveSeedTasks,
  buildQueueWithAutoSeed,
  summarizeBlockedReasons,
  summarizeQueueScores,
  summarizeValidationCoverage,
  summarizeOwnerLoad,
  classifyLaunchRisk,
  createTaskAcceptanceAudit,
  createQueueHealthSnapshot,
  pickImmediateExecution,
  runValidationCommand,
  formatTaskMarkdown,
  formatTaskJson,
  writeExecutionBrief,
  parseCliOptions,
  loadExperimentsFromFile,
  upsertQueueIntoKanban,
  syncQueueToKanban
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


test('deriveBlockedReasons supports structured dependency metadata', () => {
  const reasons = deriveBlockedReasons({
    externalDependency: {
      name: 'vendor webhook allowlist',
      owner: 'infra',
      eta: '2026-03-01',
      status: 'pending'
    }
  });

  assert.deepEqual(reasons, [
    'External dependency: vendor webhook allowlist (owner: infra, eta: 2026-03-01, status: pending)'
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

test('countReadyTasks and isExecutionCapacityLight track launchable capacity', () => {
  const queue = [
    { id: 'one', isReady: true },
    { id: 'two', isReady: false },
    { id: 'three' }
  ];

  assert.equal(countReadyTasks(queue), 2);
  assert.equal(isExecutionCapacityLight(queue, 2), true);
  assert.equal(isExecutionCapacityLight(queue, 1), false);
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

test('createAdaptiveSeedTasks deduplicates punctuation variants using slug canonicalization', () => {
  const experiments = [{ name: 'Smart defrost reminder timing tuned by prep time tier!!!' }];
  const seeds = createAdaptiveSeedTasks(experiments, { maxTasks: 3 });

  assert.equal(seeds.length, 3);
  assert.equal(seeds[0].name, 'Rescue streak comeback experiment for lapsed households');
  assert.equal(seeds[1].name, 'Win-back pantry scan streak with 2-minute rescue plan teaser');
  assert.equal(seeds[2].name, 'Household buddy invite prompt after second rescue success');
  assert.ok(!seeds.some((seed) => /Smart defrost reminder timing tuned by prep-time tier/.test(seed.name)));
});

test('createAdaptiveSeedTasks can supply a deeper PantryPal backlog when queue is very light', () => {
  const seeds = createAdaptiveSeedTasks([], { maxTasks: 6, validationCommand: 'npm test -- pantrypal' });

  assert.equal(seeds.length, 6);
  assert.equal(seeds[4].name, 'Price-drop rescue alerts bundled into weekly save packs');
  assert.equal(seeds[5].name, 'Post-dinner leftover remix prompt for next-day lunch');
  assert.ok(seeds.every((seed) => seed.validationCommand === 'npm test -- pantrypal'));
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

test('buildQueueWithAutoSeed can disable auto-seeding for strict backlog-only runs', () => {
  const experiments = [
    { name: 'Okay', impact: 0.7, confidence: 0.65, ease: 0.6, pantryPalFit: 0.8 }
  ];

  const { queue, seeded } = buildQueueWithAutoSeed(experiments, {
    minimumScore: 85,
    limit: 3,
    lightThreshold: 2,
    autoSeed: false
  });

  assert.equal(seeded, false);
  assert.equal(queue.length, 1);
  assert.match(queue[0].title, /Okay/);
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

test('buildQueueWithAutoSeed respects seedMaxTasks cap when queue is light', () => {
  const experiments = [
    { name: 'Strong baseline', impact: 0.88, confidence: 0.82, ease: 0.8, pantryPalFit: 0.94 }
  ];

  const { queue, seeded } = buildQueueWithAutoSeed(experiments, {
    minimumScore: 70,
    limit: 5,
    lightThreshold: 2,
    seedMaxTasks: 1,
    defaultOwner: 'growth-oncall'
  });

  assert.equal(seeded, true);
  assert.equal(queue.length, 2);
});

test('buildQueueWithAutoSeed can backfill to six tasks for aggressive PantryPal work loops', () => {
  const experiments = [
    { name: 'Strong baseline', impact: 0.88, confidence: 0.82, ease: 0.8, pantryPalFit: 0.94 }
  ];

  const { queue, seeded } = buildQueueWithAutoSeed(experiments, {
    minimumScore: 70,
    limit: 6,
    lightThreshold: 2,
    defaultOwner: 'growth-oncall',
    validationCommand: 'npm test -- pantrypal'
  });

  assert.equal(seeded, true);
  assert.equal(queue.length, 6);
  assert.ok(queue.filter((task) => task.validationCommand === 'npm test -- pantrypal').length >= 5);
});

test('buildQueueWithAutoSeed seeds when queue has no ready tasks even if size is not light', () => {
  const experiments = [
    { name: 'Blocked alpha', impact: 0.9, confidence: 0.8, ease: 0.7, pantryPalFit: 0.9, externalDependency: 'legal' },
    { name: 'Blocked beta', impact: 0.88, confidence: 0.77, ease: 0.72, pantryPalFit: 0.91, externalDependency: 'infra' },
    { name: 'Blocked gamma', impact: 0.86, confidence: 0.76, ease: 0.7, pantryPalFit: 0.89, externalDependency: 'policy' }
  ];

  const { queue, seeded } = buildQueueWithAutoSeed(experiments, {
    minimumScore: 70,
    limit: 5,
    lightThreshold: 2,
    readyLightThreshold: 0
  });

  assert.equal(seeded, true);
  assert.ok(queue.some((task) => task.isReady === true));
});


test('summarizeBlockedReasons returns frequency-ranked blocker reasons', () => {
  const blockers = summarizeBlockedReasons([
    { blockedReasons: ['External dependency: legal sign-off', 'External dependency: data approval'] },
    { blockedReasons: ['External dependency: legal sign-off'] },
    { blockedReasons: [] }
  ]);

  assert.deepEqual(blockers, [
    { reason: 'External dependency: legal sign-off', count: 2 },
    { reason: 'External dependency: data approval', count: 1 }
  ]);
});


test('summarizeQueueScores reports central tendency and readiness split', () => {
  const summary = summarizeQueueScores([
    { score: 90, isReady: true },
    { score: 80, isReady: false },
    { score: 70, isReady: true },
    { score: 60, isReady: false }
  ]);

  assert.equal(summary.average, 75);
  assert.equal(summary.median, 75);
  assert.equal(summary.min, 60);
  assert.equal(summary.max, 90);
  assert.equal(summary.readyAverage, 80);
  assert.equal(summary.blockedAverage, 70);
});

test('summarizeValidationCoverage reports command coverage and executable ratio', () => {
  const summary = summarizeValidationCoverage([
    { id: 'PP-1', validationCommand: 'npm test -- test/pantrypal-task-accelerator.test.js' },
    { id: 'PP-2', validationCommand: 'npm run lint' },
    { id: 'PP-3', validationCommand: '' },
    { id: 'PP-4' }
  ]);

  assert.equal(summary.tasksWithValidation, 2);
  assert.equal(summary.executableValidations, 1);
  assert.equal(summary.validationCoveragePct, 50);
  assert.equal(summary.executableValidationPct, 25);
});

test('summarizeValidationCoverage counts PantryPal tests without test/ path and ignores non-test commands', () => {
  const summary = summarizeValidationCoverage([
    { id: 'PP-1', validationCommand: 'npm test -- pantrypal-task-accelerator.test.js' },
    { id: 'PP-2', validationCommand: 'NODE --TEST test/pantrypal-growth-experiment-prioritizer.test.js' },
    { id: 'PP-3', validationCommand: 'npm run pantrypal:tasks' },
    { id: 'PP-4', validationCommand: 'pnpm test -- test/not-related.test.js' },
    { id: 'PP-5', validationCommand: 'npm run test:pantrypal' },
    { id: 'PP-6', validationCommand: 'bun test test/pantrypal-guardrail.test.ts' },
    { id: 'PP-7', validationCommand: 'npx vitest run test/pantrypal-ui.test.ts' }
  ]);

  assert.equal(summary.tasksWithValidation, 7);
  assert.equal(summary.executableValidations, 5);
  assert.equal(summary.validationCoveragePct, 100);
  assert.equal(summary.executableValidationPct, 71);
});

test('summarizeOwnerLoad reports per-owner ready/blocked totals and average score', () => {
  const summary = summarizeOwnerLoad([
    { owner: 'growth-oncall', score: 90, isReady: true },
    { owner: 'growth-oncall', score: 80, isReady: false },
    { owner: 'night-shift', score: 88, isReady: true },
    { score: 70, isReady: true }
  ]);

  assert.deepEqual(summary, [
    { owner: 'growth-oncall', total: 2, ready: 1, blocked: 1, avgScore: 85 },
    { owner: 'night-shift', total: 1, ready: 1, blocked: 0, avgScore: 88 },
    { owner: 'unassigned', total: 1, ready: 1, blocked: 0, avgScore: 70 }
  ]);
});


test('classifyLaunchRisk grades high/medium/low launch posture from readiness and validation coverage', () => {
  assert.equal(classifyLaunchRisk({ readyTasks: 0, blockedTasks: 2, readinessPct: 0, executableValidationPct: 100 }), 'high');
  assert.equal(classifyLaunchRisk({ readyTasks: 2, blockedTasks: 3, readinessPct: 65, executableValidationPct: 90 }), 'medium');
  assert.equal(classifyLaunchRisk({ readyTasks: 4, blockedTasks: 1, readinessPct: 80, executableValidationPct: 100 }), 'low');
});

test('createTaskAcceptanceAudit reports average criteria coverage and below-threshold tasks', () => {
  const audit = createTaskAcceptanceAudit([
    { id: 'PP-GROWTH-001', acceptanceCriteria: ['a', 'b', 'c', 'd', 'e', 'f'] },
    { id: 'PP-GROWTH-002', acceptanceCriteria: ['a', 'b', 'c'] }
  ], 5);

  assert.equal(audit.minimumCriteria, 5);
  assert.equal(audit.averageCriteriaCount, 4.5);
  assert.deepEqual(audit.tasksBelowMinimum, ['PP-GROWTH-002']);
  assert.equal(audit.tasksMeetingMinimum, 1);
});

test('createQueueHealthSnapshot reports light queue, readiness, and minimum score eligibility', () => {
  const experiments = [
    {
      name: 'Strong',
      impact: 0.9,
      confidence: 0.8,
      ease: 0.8,
      pantryPalFit: 0.9,
      externalDependency: 'legal sign-off',
      validationCommand: 'npm test -- test/pantrypal-task-accelerator.test.js'
    },
    { name: 'Weak', impact: 0.5, confidence: 0.5, ease: 0.5, pantryPalFit: 0.5 }
  ];
  const queue = buildTaskQueue(experiments, { minimumScore: 60, limit: 3 });
  const health = createQueueHealthSnapshot(experiments, queue, { minimumScore: 60, lightThreshold: 2 });

  assert.equal(health.incomingExperiments, 2);
  assert.equal(health.eligibleExperiments, 1);
  assert.equal(health.queueSize, 1);
  assert.equal(health.readyTasks, 0);
  assert.equal(health.blockedTasks, 1);
  assert.equal(health.readinessPct, 0);
  assert.deepEqual(health.topReadyTaskIds, []);
  assert.equal(health.topReadyScore, 0);
  assert.equal(health.topBlockedReasons.length, 1);
  assert.match(health.topBlockedReasons[0].reason, /legal sign-off/);
  assert.equal(health.scoreAverage, queue[0].score);
  assert.equal(health.scoreMedian, queue[0].score);
  assert.equal(health.scoreMin, queue[0].score);
  assert.equal(health.scoreMax, queue[0].score);
  assert.equal(health.scoreReadyAverage, 0);
  assert.equal(health.scoreBlockedAverage, queue[0].score);
  assert.equal(health.isLight, true);
  assert.equal(health.isReadyCapacityLight, true);
  assert.equal(health.threshold, 2);
  assert.equal(health.readyLightThreshold, 1);
  assert.equal(health.minimumScore, 60);
  assert.equal(health.averageCriteriaCount, 6);
  assert.equal(health.minimumCriteria, 6);
  assert.deepEqual(health.tasksBelowCriteriaThreshold, []);
  assert.equal(health.tasksWithValidation, 1);
  assert.equal(health.executableValidations, 1);
  assert.equal(health.validationCoveragePct, 100);
  assert.equal(health.executableValidationPct, 100);
  assert.equal(health.ownerLoad.length, 1);
  assert.equal(health.ownerLoad[0].owner, 'growth-oncall');
  assert.equal(health.ownerLoad[0].blocked, 1);
  assert.equal(health.readyToBlockedRatio, 0);
  assert.equal(health.launchRisk, 'high');
  assert.match(health.nextAction, /Resolve blockers or auto-seed fresh PantryPal experiments/);
});

test('createQueueHealthSnapshot applies custom minimumCriteria thresholds', () => {
  const experiments = [
    { name: 'Strong', impact: 0.9, confidence: 0.8, ease: 0.8, pantryPalFit: 0.9 }
  ];
  const queue = [{
    id: 'PP-GROWTH-001-strong',
    title: 'Strong',
    score: 90,
    acceptanceCriteria: ['a', 'b', 'c', 'd', 'e'],
    blockedReasons: [],
    isReady: true
  }];

  const health = createQueueHealthSnapshot(experiments, queue, { minimumCriteria: 6 });

  assert.equal(health.minimumCriteria, 6);
  assert.deepEqual(health.tasksBelowCriteriaThreshold, ['PP-GROWTH-001-strong']);
});

test('createQueueHealthSnapshot exposes top ready tasks sorted by score', () => {
  const experiments = [
    { name: 'A', impact: 0.9, confidence: 0.8, ease: 0.7, pantryPalFit: 0.9 },
    { name: 'B', impact: 0.8, confidence: 0.8, ease: 0.8, pantryPalFit: 0.9 },
    { name: 'C', impact: 0.7, confidence: 0.7, ease: 0.8, pantryPalFit: 0.9 },
    { name: 'D', impact: 0.9, confidence: 0.9, ease: 0.8, pantryPalFit: 0.95 }
  ];
  const queue = [
    { id: 'PP-1', title: 'One', score: 75, acceptanceCriteria: ['a'], blockedReasons: [], isReady: true },
    { id: 'PP-2', title: 'Two', score: 92, acceptanceCriteria: ['a'], blockedReasons: [], isReady: true },
    { id: 'PP-3', title: 'Three', score: 81, acceptanceCriteria: ['a'], blockedReasons: [], isReady: true },
    { id: 'PP-4', title: 'Four', score: 88, acceptanceCriteria: ['a'], blockedReasons: ['policy'], isReady: false }
  ];

  const health = createQueueHealthSnapshot(experiments, queue);

  assert.deepEqual(health.topReadyTaskIds, ['PP-2', 'PP-3', 'PP-1']);
  assert.equal(health.topReadyScore, 92);
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

test('pickImmediateExecution enforces minimum acceptance criteria when configured', () => {
  const plan = pickImmediateExecution([
    {
      id: 'PP-GROWTH-001-ready-thin',
      title: 'Ready but thin criteria',
      isReady: true,
      blockedReasons: [],
      acceptanceCriteria: ['c1', 'c2'],
      validationCommand: 'npm test -- thin'
    }
  ], { minimumCriteria: 3 });

  assert.equal(plan.blockedQueue, true);
  assert.equal(plan.taskId, null);
  assert.match(plan.blockedReasons.join(' | '), /minimum acceptance criteria \(3\)/);
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
    {
      incomingExperiments: 3,
      eligibleExperiments: 2,
      queueSize: 1,
      readyTasks: 1,
      blockedTasks: 0,
      readinessPct: 100,
      scoreAverage: 91.23,
      scoreMedian: 91.23,
      scoreMin: 91.23,
      scoreMax: 91.23,
      scoreReadyAverage: 91.23,
      scoreBlockedAverage: 0,
      isLight: true,
      threshold: 2,
      minimumCriteria: 6,
      tasksMeetingMinimum: 1,
      averageCriteriaCount: 6.5,
      tasksBelowCriteriaThreshold: [],
      tasksWithValidation: 1,
      executableValidations: 1,
      validationCoveragePct: 100,
      executableValidationPct: 100,
      ownerLoad: [{ owner: 'growth', total: 1, ready: 1, blocked: 0, avgScore: 91.23 }],
      readyToBlockedRatio: Number.POSITIVE_INFINITY,
      launchRisk: 'low',
      nextAction: 'Execute top ready PantryPal experiment now and monitor first-hour guardrail.'
    }
  );

  assert.match(markdown, /PantryPal Task Queue/);
  assert.match(markdown, /PP-GROWTH-001-foo/);
  assert.match(markdown, /Queue Health/);
  assert.match(markdown, /Ready tasks: 1/);
  assert.match(markdown, /Blocked tasks: 0/);
  assert.match(markdown, /Readiness: 100%/);
  assert.match(markdown, /Top blockers: none/);
  assert.match(markdown, /Score summary: avg 91.23, median 91.23, min 91.23, max 91.23/);
  assert.match(markdown, /Score by readiness: ready avg 91.23, blocked avg 0/);
  assert.match(markdown, /Acceptance criteria coverage: 1\/1 tasks meet minimum 6 checks/);
  assert.match(markdown, /Average criteria per task: 6.5/);
  assert.match(markdown, /Tasks below criteria threshold: 0/);
  assert.match(markdown, /Validation coverage: 1\/1 tasks \(100%\)/);
  assert.match(markdown, /Executable validation commands: 1\/1 tasks \(100%\)/);
  assert.match(markdown, /Owner load: growth total 1 \(ready 1, blocked 0, avg 91.23\)/);
  assert.match(markdown, /Ready\/blocked ratio: inf/);
  assert.match(markdown, /Launch risk: low/);
  assert.match(markdown, /Next action: Execute top ready PantryPal experiment now/);
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
    { seeded: true, generatedAt: '2026-02-28T01:56:00.000Z', sync: { synced: true, inserted: 3, kanbanFile: 'data/kanban.json' } },
    {
      incomingExperiments: 4,
      eligibleExperiments: 3,
      queueSize: 1,
      readyTasks: 1,
      blockedTasks: 0,
      readinessPct: 100,
      isLight: true,
      threshold: 2,
      nextAction: 'Execute top ready PantryPal experiment now and monitor first-hour guardrail.'
    }
  );

  const parsed = JSON.parse(json);
  assert.equal(parsed.seeded, true);
  assert.equal(parsed.generatedAt, '2026-02-28T01:56:00.000Z');
  assert.equal(parsed.sync.synced, true);
  assert.equal(parsed.sync.inserted, 3);
  assert.equal(parsed.health.eligibleExperiments, 3);
  assert.equal(parsed.health.readinessPct, 100);
  assert.match(parsed.health.nextAction, /Execute top ready PantryPal experiment now/);
  assert.equal(parsed.queue.length, 1);
  assert.equal(parsed.immediateExecution.taskId, 'PP-GROWTH-001-foo');
  assert.equal(parsed.validation.status, 'PASS');
});

test('parseCliOptions supports explicit thresholds and json mode', () => {
  const options = parseCliOptions([
    '--json',
    '--limit', '5',
    '--minimum-score=82',
    '--light-threshold', '4',
    '--ready-light-threshold', '2',
    '--minimum-criteria', '7',
    '--seed-max-tasks', '2',
    '--validation-timeout-ms', '45000'
  ]);

  assert.equal(options.outputFormat, 'json');
  assert.equal(options.limit, 5);
  assert.equal(options.minimumScore, 82);
  assert.equal(options.lightThreshold, 4);
  assert.equal(options.readyLightThreshold, 2);
  assert.equal(options.minimumCriteria, 7);
  assert.equal(options.seedMaxTasks, 2);
  assert.equal(options.validationTimeoutMs, 45000);
  assert.equal(options.validate, true);
});

test('parseCliOptions accepts decimal minimum-score values', () => {
  const options = parseCliOptions(['--minimum-score', '82.5']);

  assert.equal(options.minimumScore, 82.5);
});

test('parseCliOptions preserves defaults for invalid numeric values and disables validation', () => {
  const options = parseCliOptions(['--limit', '0', '--minimum-score', 'abc', '--validation-timeout-ms', '-1', '--no-validate']);

  assert.equal(options.limit, 3);
  assert.equal(options.minimumScore, 75);
  assert.equal(options.lightThreshold, 2);
  assert.equal(options.readyLightThreshold, 1);
  assert.equal(options.minimumCriteria, 6);
  assert.equal(options.validationTimeoutMs, null);
  assert.equal(options.validate, false);
  assert.equal(options.autoSeed, true);
});

test('parseCliOptions captures no-auto-seed flag', () => {
  const options = parseCliOptions(['--no-auto-seed']);

  assert.equal(options.autoSeed, false);
});
test('parseCliOptions accepts experiment file, owner, and validation command overrides', () => {
  const options = parseCliOptions([
    '--experiments-file', 'data/pantrypal-experiments.json',
    '--default-owner=growth-night-shift',
    '--validation-command', 'npm test -- test/pantrypal-task-accelerator.test.js',
    '--execution-brief-out', 'artifacts/pantrypal-execution-brief.md'
  ]);

  assert.equal(options.experimentsFile, 'data/pantrypal-experiments.json');
  assert.equal(options.defaultOwner, 'growth-night-shift');
  assert.equal(options.validationCommand, 'npm test -- test/pantrypal-task-accelerator.test.js');
  assert.equal(options.executionBriefOut, 'artifacts/pantrypal-execution-brief.md');
});

test('writeExecutionBrief persists a markdown launch brief with checklist and validation output', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pantrypal-brief-'));
  const briefPath = path.join(tempDir, 'execution-brief.md');

  const result = writeExecutionBrief(briefPath, {
    taskId: 'PP-GROWTH-001-fast-rescue',
    title: 'Fast rescue',
    validationCommand: 'npm test -- test/pantrypal-task-accelerator.test.js',
    acceptanceChecklist: ['criterion 1', 'criterion 2'],
    executionNow: ['step 1', 'step 2']
  }, {
    status: 'PASS',
    exitCode: 0,
    outputSnippet: 'all good'
  }, {
    queueSize: 3,
    readyTasks: 3,
    blockedTasks: 0,
    readinessPct: 100,
    topBlockedReasons: [],
    scoreAverage: 88.1,
    scoreMedian: 88.1,
    scoreMin: 82.2,
    scoreMax: 93.7,
    scoreReadyAverage: 88.1,
    scoreBlockedAverage: 0,
    tasksMeetingMinimum: 3,
    minimumCriteria: 6,
    averageCriteriaCount: 6.67,
    tasksBelowCriteriaThreshold: [],
    ownerLoad: [{ owner: 'growth-oncall', total: 3, ready: 3, blocked: 0, avgScore: 88.1 }],
    nextAction: 'Launch now.'
  }, {
    generatedAt: '2026-02-28T03:30:00.000Z'
  });

  const content = fs.readFileSync(briefPath, 'utf8');
  assert.equal(result.taskId, 'PP-GROWTH-001-fast-rescue');
  assert.equal(result.generatedAt, '2026-02-28T03:30:00.000Z');
  assert.match(content, /PantryPal Immediate Execution Brief/);
  assert.match(content, /Top task: PP-GROWTH-001-fast-rescue/);
  assert.match(content, /- \[ \] criterion 1/);
  assert.match(content, /Top blockers: none/);
  assert.match(content, /Score summary: avg 88.1, median 88.1, min 82.2, max 93.7/);
  assert.match(content, /Score by readiness: ready avg 88.1, blocked avg 0/);
  assert.match(content, /Acceptance criteria coverage: 3\/3 tasks meet minimum 6 checks/);
  assert.match(content, /Average criteria per task: 6.67/);
  assert.match(content, /Tasks below criteria threshold: 0/);
  assert.match(content, /Owner load: growth-oncall total 3 \(ready 3, blocked 0, avg 88.1\)/);
  assert.match(content, /Status: PASS/);
  assert.match(content, /all good/);
});

test('loadExperimentsFromFile loads a valid JSON experiment array', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pantrypal-'));
  const file = path.join(tempDir, 'experiments.json');
  const payload = [{ name: 'Rescue boost', impact: 0.9, confidence: 0.8, ease: 0.7, pantryPalFit: 1 }];

  fs.writeFileSync(file, JSON.stringify(payload), 'utf8');

  const experiments = loadExperimentsFromFile(file);
  assert.equal(experiments.length, 1);
  assert.equal(experiments[0].name, 'Rescue boost');
});

test('loadExperimentsFromFile throws when payload is not an array', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pantrypal-'));
  const file = path.join(tempDir, 'invalid.json');

  fs.writeFileSync(file, JSON.stringify({ name: 'not-an-array' }), 'utf8');

  assert.throws(() => loadExperimentsFromFile(file), /Expected an array of experiments/);
});


test('upsertQueueIntoKanban inserts new PantryPal todo tasks with acceptance criteria metadata', () => {
  const seedKanban = { columns: { todo: [] }, activityLog: [] };
  const queue = [{
    id: 'PP-GROWTH-001-fast-rescue',
    title: 'Fast rescue trial',
    score: 88.2,
    owner: 'growth-oncall',
    validationCommand: 'npm test -- growth',
    acceptanceCriteria: ['c1', 'c2'],
    blockedReasons: []
  }];

  const { inserted, kanban } = upsertQueueIntoKanban(queue, seedKanban, {
    source: 'unit-test',
    now: '2026-02-28T03:00:00.000Z'
  });

  assert.equal(inserted, 1);
  assert.equal(kanban.columns.todo.length, 1);
  assert.equal(kanban.columns.todo[0].name, '[PantryPal] Fast rescue trial');
  assert.match(kanban.columns.todo[0].description, /Acceptance criteria:/);
  assert.equal(kanban.columns.todo[0].priority, 'high');
  assert.equal(kanban.activityLog[0].taskId, 'PP-GROWTH-001-fast-rescue');
});

test('upsertQueueIntoKanban avoids duplicate task ids already in todo', () => {
  const seedKanban = {
    columns: {
      todo: [{ id: 'PP-GROWTH-001-fast-rescue', name: '[PantryPal] Fast rescue trial' }]
    },
    activityLog: []
  };

  const queue = [{
    id: 'PP-GROWTH-001-fast-rescue',
    title: 'Fast rescue trial',
    score: 88.2,
    owner: 'growth-oncall',
    validationCommand: 'npm test -- growth',
    acceptanceCriteria: ['c1'],
    blockedReasons: []
  }];

  const { inserted, kanban } = upsertQueueIntoKanban(queue, seedKanban);
  assert.equal(inserted, 0);
  assert.equal(kanban.columns.todo.length, 1);
});

test('syncQueueToKanban writes inserted queue tasks to provided file path', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pantrypal-kanban-'));
  const kanbanFile = path.join(tempDir, 'kanban.json');
  fs.writeFileSync(kanbanFile, JSON.stringify({ columns: { todo: [] }, activityLog: [] }), 'utf8');

  const result = syncQueueToKanban([{
    id: 'PP-GROWTH-003-sync',
    title: 'Sync me',
    score: 79,
    owner: 'growth-oncall',
    validationCommand: 'npm test',
    acceptanceCriteria: ['c1'],
    blockedReasons: []
  }], { kanbanFile, source: 'unit-test', now: '2026-02-28T03:10:00.000Z' });

  const persisted = JSON.parse(fs.readFileSync(kanbanFile, 'utf8'));
  assert.equal(result.synced, true);
  assert.equal(result.inserted, 1);
  assert.equal(persisted.columns.todo.length, 1);
  assert.equal(persisted.columns.todo[0].id, 'PP-GROWTH-003-sync');
});

test('parseCliOptions captures sync-kanban and kanban-file flags', () => {
  const options = parseCliOptions(['--sync-kanban', '--kanban-file', 'data/kanban.json']);
  assert.equal(options.syncKanban, true);
  assert.equal(options.kanbanFile, 'data/kanban.json');
  assert.equal(options.readyOnlySync, false);
});

test('parseCliOptions captures ready-only-sync flag', () => {
  const options = parseCliOptions(['--sync-kanban', '--kanban-file', 'data/kanban.json', '--ready-only-sync']);
  assert.equal(options.syncKanban, true);
  assert.equal(options.readyOnlySync, true);
});

test('parseCliOptions captures bootstrap-kanban flag', () => {
  const options = parseCliOptions(['--sync-kanban', '--kanban-file', 'data/kanban.json', '--bootstrap-kanban']);
  assert.equal(options.syncKanban, true);
  assert.equal(options.bootstrapKanban, true);
});

test('syncQueueToKanban can skip blocked tasks in ready-only mode', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pantrypal-kanban-ready-only-'));
  const kanbanFile = path.join(tempDir, 'kanban.json');
  fs.writeFileSync(kanbanFile, JSON.stringify({ columns: { todo: [] }, activityLog: [] }), 'utf8');

  const result = syncQueueToKanban([
    {
      id: 'PP-GROWTH-010-ready',
      title: 'Ready task',
      score: 82,
      owner: 'growth-oncall',
      validationCommand: 'npm test',
      acceptanceCriteria: ['c1'],
      blockedReasons: [],
      isReady: true
    },
    {
      id: 'PP-GROWTH-011-blocked',
      title: 'Blocked task',
      score: 84,
      owner: 'growth-oncall',
      validationCommand: 'npm test',
      acceptanceCriteria: ['c1'],
      blockedReasons: ['External dependency: legal sign-off'],
      isReady: false
    }
  ], {
    kanbanFile,
    source: 'unit-test',
    now: '2026-02-28T03:20:00.000Z',
    readyOnly: true
  });

  const persisted = JSON.parse(fs.readFileSync(kanbanFile, 'utf8'));
  assert.equal(result.synced, true);
  assert.equal(result.readyOnly, true);
  assert.equal(result.attempted, 1);
  assert.equal(result.skippedBlocked, 1);
  assert.equal(result.inserted, 1);
  assert.equal(persisted.columns.todo.length, 1);
  assert.equal(persisted.columns.todo[0].id, 'PP-GROWTH-010-ready');
});

test('syncQueueToKanban bootstraps a missing kanban file when enabled', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pantrypal-kanban-bootstrap-'));
  const kanbanFile = path.join(tempDir, 'kanban.json');

  const result = syncQueueToKanban([{
    id: 'PP-GROWTH-012-bootstrap',
    title: 'Bootstrap task',
    score: 81,
    owner: 'growth-oncall',
    validationCommand: 'npm test',
    acceptanceCriteria: ['c1'],
    blockedReasons: []
  }], {
    kanbanFile,
    source: 'unit-test',
    now: '2026-02-28T03:40:00.000Z',
    bootstrapKanban: true
  });

  const persisted = JSON.parse(fs.readFileSync(kanbanFile, 'utf8'));
  assert.equal(result.synced, true);
  assert.equal(result.bootstrapped, true);
  assert.equal(result.inserted, 1);
  assert.ok(Array.isArray(persisted.columns.inProgress));
  assert.ok(Array.isArray(persisted.columns.done));
  assert.equal(persisted.columns.todo[0].id, 'PP-GROWTH-012-bootstrap');
});
