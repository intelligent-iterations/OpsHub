#!/usr/bin/env node

const { execSync } = require('node:child_process');
const { rankExperiments } = require('./pantrypal-growth-experiment-prioritizer');

function toSlug(name) {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64);
}

function createAcceptanceCriteria(experiment) {
  const metric = experiment.primaryMetric ?? '7-day activation rate';
  const targetLift = experiment.targetLiftPct ?? 8;
  const minimumSampleSize = experiment.minimumSampleSize ?? 1200;
  const experimentWindowDays = experiment.experimentWindowDays ?? 14;
  const guardrail = experiment.guardrail ?? 'unsubscribe rate does not increase by >1%';
  const validationCommand = experiment.validationCommand ?? 'npm test';

  return [
    `Experiment spec includes hypothesis, segment, channel, and success metric (${metric}).`,
    `A/B test is configured with event instrumentation and minimum detectable lift target of ${targetLift}%.`,
    `Sample-size gate is defined: at least ${minimumSampleSize} qualified households over ${experimentWindowDays} days.`,
    `Guardrail is monitored and passes: ${guardrail}.`,
    `Validation completed with command: ${validationCommand}.`,
    'Decision log is updated with launch date, owner, and rollback trigger.'
  ];
}

function deriveBlockedReasons(experiment) {
  if (!experiment.externalDependency) return [];

  if (typeof experiment.externalDependency === 'string') {
    return [`External dependency: ${experiment.externalDependency}`];
  }

  if (Array.isArray(experiment.externalDependency)) {
    return experiment.externalDependency
      .map((item) => String(item).trim())
      .filter(Boolean)
      .map((item) => `External dependency: ${item}`);
  }

  return ['External dependency must be cleared before launch'];
}

function buildTaskQueue(experiments, options = {}) {
  const limit = options.limit ?? 3;
  const minimumScore = options.minimumScore;
  const ranked = rankExperiments(experiments);
  const eligible = typeof minimumScore === 'number'
    ? ranked.filter((experiment) => experiment.score >= minimumScore)
    : ranked;

  return eligible.slice(0, limit).map((experiment, index) => {
    const blockedReasons = deriveBlockedReasons(experiment);
    return {
      id: `PP-GROWTH-${String(index + 1).padStart(3, '0')}-${toSlug(experiment.name)}`,
      title: experiment.name,
      score: experiment.score,
      owner: options.defaultOwner ?? 'growth-oncall',
      validationCommand: experiment.validationCommand ?? 'npm test',
      acceptanceCriteria: createAcceptanceCriteria(experiment),
      blockedReasons,
      isReady: blockedReasons.length === 0
    };
  });
}

function isQueueLight(taskQueue, threshold = 2) {
  return taskQueue.length <= threshold;
}

function createLightQueueSeedTasks(options = {}) {
  return [
    {
      name: 'Rescue streak comeback experiment for lapsed households',
      impact: 0.84,
      confidence: 0.71,
      ease: 0.66,
      pantryPalFit: 0.96,
      primaryMetric: 'week-2 rescue completion rate',
      targetLiftPct: 10,
      minimumSampleSize: 1600,
      experimentWindowDays: 14,
      guardrail: 'notification opt-out rate stays below 1.5%',
      validationCommand: options.validationCommand ?? 'npm test -- test/pantrypal-growth-experiment-prioritizer.test.js'
    },
    {
      name: 'Smart defrost reminder timing tuned by prep-time tier',
      impact: 0.77,
      confidence: 0.69,
      ease: 0.73,
      pantryPalFit: 0.92,
      primaryMetric: 'same-day rescue completion rate',
      targetLiftPct: 7,
      minimumSampleSize: 1400,
      experimentWindowDays: 10,
      guardrail: 'push dismiss rate does not increase by >2%',
      validationCommand: options.validationCommand ?? 'npm test -- test/pantrypal-task-accelerator.test.js'
    }
  ];
}

function createAdaptiveSeedTasks(experiments, options = {}) {
  const maxTasks = Math.max(0, options.maxTasks ?? 2);
  const existingNames = new Set(experiments.map((experiment) => (experiment.name ?? '').trim().toLowerCase()));
  const catalog = createLightQueueSeedTasks(options).concat([
    {
      name: 'Win-back pantry scan streak with 2-minute rescue plan teaser',
      impact: 0.81,
      confidence: 0.68,
      ease: 0.7,
      pantryPalFit: 0.95,
      primaryMetric: 'week-1 rescue plan creation rate',
      targetLiftPct: 9,
      minimumSampleSize: 1500,
      experimentWindowDays: 14,
      guardrail: 'session crash rate does not increase by >0.3%',
      validationCommand: options.validationCommand ?? 'npm test -- test/pantrypal-task-accelerator.test.js'
    },
    {
      name: 'Household buddy invite prompt after second rescue success',
      impact: 0.75,
      confidence: 0.64,
      ease: 0.76,
      pantryPalFit: 0.9,
      primaryMetric: 'new household collaborator invites per activated user',
      targetLiftPct: 6,
      minimumSampleSize: 1300,
      experimentWindowDays: 12,
      guardrail: 'notification mute rate does not increase by >1.8%',
      validationCommand: options.validationCommand ?? 'npm test -- test/pantrypal-growth-experiment-prioritizer.test.js'
    }
  ]);

  const uniqueSeeds = [];
  for (const seed of catalog) {
    const key = seed.name.trim().toLowerCase();
    if (existingNames.has(key)) continue;
    uniqueSeeds.push(seed);
    existingNames.add(key);
    if (uniqueSeeds.length >= maxTasks) break;
  }

  return uniqueSeeds;
}

function buildQueueWithAutoSeed(experiments, options = {}) {
  const buildOptions = {
    defaultOwner: options.defaultOwner,
    limit: options.limit,
    minimumScore: options.minimumScore
  };

  let seeded = false;
  let queue = buildTaskQueue(experiments, buildOptions);

  if (isQueueLight(queue, options.lightThreshold)) {
    const desiredQueueSize = Math.max(options.limit ?? 3, (options.lightThreshold ?? 2) + 1);
    const missingCount = Math.max(0, desiredQueueSize - queue.length);
    const seeds = createAdaptiveSeedTasks(experiments, {
      validationCommand: options.validationCommand,
      maxTasks: missingCount
    });

    if (seeds.length) {
      seeded = true;
      queue = buildTaskQueue(experiments.concat(seeds), buildOptions);
    }
  }

  if (!queue.length && typeof options.minimumScore === 'number') {
    queue = buildTaskQueue(experiments, {
      defaultOwner: options.defaultOwner,
      limit: options.limit
    });
  }

  return { queue, seeded };
}

function createQueueHealthSnapshot(experiments, queue, options = {}) {
  const minimumScore = options.minimumScore;
  const threshold = options.lightThreshold ?? 2;
  const ranked = rankExperiments(experiments);
  const aboveMinimum = typeof minimumScore === 'number'
    ? ranked.filter((experiment) => experiment.score >= minimumScore)
    : ranked;
  const readyTasks = queue.filter((task) => task.isReady !== false).length;
  const blockedTasks = Math.max(0, queue.length - readyTasks);
  const readinessPct = queue.length ? Math.round((readyTasks / queue.length) * 100) : 0;

  return {
    incomingExperiments: experiments.length,
    eligibleExperiments: aboveMinimum.length,
    queueSize: queue.length,
    readyTasks,
    blockedTasks,
    readinessPct,
    isLight: isQueueLight(queue, threshold),
    threshold,
    minimumScore: typeof minimumScore === 'number' ? minimumScore : null,
    nextAction: blockedTasks > 0 && readyTasks === 0
      ? 'Resolve blockers or auto-seed fresh PantryPal experiments before launch.'
      : 'Execute top ready PantryPal experiment now and monitor first-hour guardrail.'
  };
}

function pickImmediateExecution(taskQueue) {
  if (!taskQueue.length) return null;

  const top = taskQueue.find((task) => task.isReady !== false);
  if (!top) {
    const blockedReasons = [...new Set(taskQueue.flatMap((task) => task.blockedReasons || []))];
    return {
      taskId: null,
      title: null,
      validationCommand: null,
      acceptanceChecklist: [],
      executionNow: [],
      blockedQueue: true,
      blockedReasons
    };
  }

  const acceptanceChecklist = (top.acceptanceCriteria || []).slice(0, 3);

  return {
    taskId: top.id,
    title: top.title,
    validationCommand: top.validationCommand,
    acceptanceChecklist,
    executionNow: [
      'Draft experiment brief in tracker with owner + rollout window.',
      'Prepare treatment/control variants and QA events in staging.',
      `Gate launch against acceptance checklist (${acceptanceChecklist.length} critical checks).`,
      `Run validation: ${top.validationCommand}.`,
      'Launch to 10% holdout split and monitor first-hour guardrail.'
    ]
  };
}

function runValidationCommand(command, options = {}) {
  if (!command) {
    return {
      status: 'NOT_RUN',
      command: null,
      exitCode: null,
      durationMs: 0,
      outputSnippet: 'No validation command configured.'
    };
  }

  const run = options.runner ?? ((cmd) => execSync(cmd, {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout: options.timeoutMs ?? 120000,
    maxBuffer: options.maxBuffer ?? 1024 * 1024
  }));

  const startedAt = Date.now();

  try {
    const output = run(command);
    return {
      status: 'PASS',
      command,
      exitCode: 0,
      durationMs: Date.now() - startedAt,
      outputSnippet: String(output ?? '').trim().split('\n').slice(-8).join('\n') || 'Validation completed with no output.'
    };
  } catch (error) {
    const combinedOutput = [error.stdout, error.stderr].filter(Boolean).join('\n').trim();

    return {
      status: 'FAIL',
      command,
      exitCode: Number.isInteger(error.status) ? error.status : 1,
      durationMs: Date.now() - startedAt,
      outputSnippet: combinedOutput.split('\n').slice(-8).join('\n') || String(error.message)
    };
  }
}

function formatTaskMarkdown(taskQueue, executionPlan, validationResult = null, health = null) {
  const taskLines = taskQueue.map((task) => {
    const criteria = task.acceptanceCriteria.map((line) => `    - [ ] ${line}`).join('\n');
    return `- [ ] ${task.id} — ${task.title} (score: ${task.score.toFixed(2)}, owner: ${task.owner})\n  - Acceptance criteria:\n${criteria}`;
  }).join('\n');

  const acceptanceLines = executionPlan?.acceptanceChecklist?.length
    ? executionPlan.acceptanceChecklist.map((line, idx) => `${idx + 1}. ${line}`).join('\n')
    : '1. No critical checklist available';

  const executionLines = executionPlan?.executionNow?.length
    ? executionPlan.executionNow.map((step, idx) => `${idx + 1}. ${step}`).join('\n')
    : '1. No tasks available';

  const blockedLines = executionPlan?.blockedQueue
    ? (executionPlan.blockedReasons.length
      ? executionPlan.blockedReasons.map((reason, index) => `${index + 1}. ${reason}`).join('\n')
      : '1. Queue is blocked but no reason was provided')
    : null;

  const validationLines = validationResult
    ? [
      `Status: ${validationResult.status}`,
      `Command: ${validationResult.command ?? 'n/a'}`,
      `Exit code: ${validationResult.exitCode ?? 'n/a'}`,
      `Duration: ${validationResult.durationMs}ms`,
      'Recent output:',
      '```',
      validationResult.outputSnippet || 'n/a',
      '```'
    ].join('\n')
    : 'Status: NOT_RUN';

  const healthLines = health
    ? [
      `Incoming experiments: ${health.incomingExperiments}`,
      `Eligible experiments (minimum score): ${health.eligibleExperiments}`,
      `Queue size: ${health.queueSize}`,
      `Ready tasks: ${health.readyTasks ?? 'n/a'}`,
      `Blocked tasks: ${health.blockedTasks ?? 'n/a'}`,
      `Readiness: ${health.readinessPct ?? 'n/a'}%`,
      `Queue light: ${health.isLight ? 'yes' : 'no'} (threshold: ${health.threshold})`,
      `Next action: ${health.nextAction ?? 'n/a'}`
    ].join('\n')
    : 'Queue health unavailable';

  return [
    '# PantryPal Task Queue (Auto-generated)',
    '',
    taskLines,
    '',
    '## Queue Health',
    healthLines,
    '',
    '## Execute Immediately',
    executionPlan ? `Top task: ${executionPlan.taskId} — ${executionPlan.title}` : 'Top task: none',
    '### Critical Acceptance Checklist',
    acceptanceLines,
    '',
    '### Launch Steps',
    executionLines,
    blockedLines ? '' : null,
    blockedLines ? '### Blockers' : null,
    blockedLines || null,
    '',
    '## Validation Result',
    validationLines,
    ''
  ].filter((line) => line !== null).join('\n');
}

function formatTaskJson(taskQueue, executionPlan, validationResult = null, metadata = {}, health = null) {
  return JSON.stringify({
    generatedAt: metadata.generatedAt ?? new Date().toISOString(),
    seeded: Boolean(metadata.seeded),
    health,
    queue: taskQueue,
    immediateExecution: executionPlan,
    validation: validationResult
  }, null, 2);
}

if (require.main === module) {
  let experiments = [
    {
      name: 'Personalized rescue recipes from expiring inventory',
      impact: 0.89,
      confidence: 0.7,
      ease: 0.62,
      pantryPalFit: 0.98,
      primaryMetric: 'weekly meal-plan saves',
      targetLiftPct: 12,
      guardrail: 'recipe dismiss rate stays below 20%',
      validationCommand: 'npm test -- test/pantrypal-task-accelerator.test.js'
    },
    {
      name: 'Referral booster after first successful pantry save',
      impact: 0.67,
      confidence: 0.66,
      ease: 0.85,
      pantryPalFit: 0.8,
      validationCommand: 'npm test -- test/pantrypal-growth-experiment-prioritizer.test.js'
    },
    {
      name: 'Household challenge leaderboard for waste reduction streaks',
      impact: 0.8,
      confidence: 0.58,
      ease: 0.54,
      pantryPalFit: 0.9,
      validationCommand: 'npm test -- test/pantrypal-task-accelerator.test.js'
    }
  ];

  const outputFormat = process.argv.includes('--json') ? 'json' : 'markdown';

  const { queue, seeded } = buildQueueWithAutoSeed(experiments, {
    defaultOwner: 'growth-oncall',
    limit: 3,
    minimumScore: 75,
    lightThreshold: 2
  });

  const executionPlan = pickImmediateExecution(queue);
  const validationResult = runValidationCommand(executionPlan?.validationCommand);
  const health = createQueueHealthSnapshot(experiments, queue, {
    minimumScore: 75,
    lightThreshold: 2
  });

  const output = outputFormat === 'json'
    ? formatTaskJson(queue, executionPlan, validationResult, { seeded }, health)
    : formatTaskMarkdown(queue, executionPlan, validationResult, health);

  process.stdout.write(output);
}

module.exports = {
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
};