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
    `A/B test is configured with event instrumentation and minimum detectable lift target of ${targetLift}% .`,
    `Sample-size gate is defined: at least ${minimumSampleSize} qualified households over ${experimentWindowDays} days.`,
    `Guardrail is monitored and passes: ${guardrail}.`,
    `Validation completed with command: ${validationCommand}.`,
    'Decision log is updated with launch date, owner, and rollback trigger.'
  ];
}

function buildTaskQueue(experiments, options = {}) {
  const limit = options.limit ?? 3;
  const minimumScore = options.minimumScore;
  const ranked = rankExperiments(experiments);
  const eligible = typeof minimumScore === 'number'
    ? ranked.filter((experiment) => experiment.score >= minimumScore)
    : ranked;

  return eligible.slice(0, limit).map((experiment, index) => ({
    id: `PP-GROWTH-${String(index + 1).padStart(3, '0')}-${toSlug(experiment.name)}`,
    title: experiment.name,
    score: experiment.score,
    owner: options.defaultOwner ?? 'growth-oncall',
    validationCommand: experiment.validationCommand ?? 'npm test',
    acceptanceCriteria: createAcceptanceCriteria(experiment)
  }));
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

function buildQueueWithAutoSeed(experiments, options = {}) {
  const buildOptions = {
    defaultOwner: options.defaultOwner,
    limit: options.limit,
    minimumScore: options.minimumScore
  };

  let seeded = false;
  let queue = buildTaskQueue(experiments, buildOptions);

  if (isQueueLight(queue, options.lightThreshold)) {
    seeded = true;
    const seeds = createLightQueueSeedTasks({ validationCommand: options.validationCommand });
    queue = buildTaskQueue(experiments.concat(seeds), buildOptions);
  }

  if (!queue.length && typeof options.minimumScore === 'number') {
    queue = buildTaskQueue(experiments, {
      defaultOwner: options.defaultOwner,
      limit: options.limit
    });
  }

  return { queue, seeded };
}

function pickImmediateExecution(taskQueue) {
  if (!taskQueue.length) return null;

  const [top] = taskQueue;
  return {
    taskId: top.id,
    title: top.title,
    validationCommand: top.validationCommand,
    executionNow: [
      'Draft experiment brief in tracker with owner + rollout window.',
      'Prepare treatment/control variants and QA events in staging.',
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

function formatTaskMarkdown(taskQueue, executionPlan, validationResult = null) {
  const taskLines = taskQueue.map((task) => {
    const criteria = task.acceptanceCriteria.map((line) => `    - [ ] ${line}`).join('\n');
    return `- [ ] ${task.id} — ${task.title} (score: ${task.score.toFixed(2)}, owner: ${task.owner})\n  - Acceptance criteria:\n${criteria}`;
  }).join('\n');

  const executionLines = executionPlan
    ? executionPlan.executionNow.map((step, idx) => `${idx + 1}. ${step}`).join('\n')
    : '1. No tasks available';

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

  return [
    '# PantryPal Task Queue (Auto-generated)',
    '',
    taskLines,
    '',
    '## Execute Immediately',
    executionPlan ? `Top task: ${executionPlan.taskId} — ${executionPlan.title}` : 'Top task: none',
    executionLines,
    '',
    '## Validation Result',
    validationLines,
    ''
  ].join('\n');
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

  const { queue } = buildQueueWithAutoSeed(experiments, {
    defaultOwner: 'growth-oncall',
    limit: 3,
    minimumScore: 75,
    lightThreshold: 2
  });

  const executionPlan = pickImmediateExecution(queue);
  const validationResult = runValidationCommand(executionPlan?.validationCommand);
  process.stdout.write(formatTaskMarkdown(queue, executionPlan, validationResult));
}

module.exports = {
  toSlug,
  createAcceptanceCriteria,
  buildTaskQueue,
  isQueueLight,
  createLightQueueSeedTasks,
  buildQueueWithAutoSeed,
  pickImmediateExecution,
  runValidationCommand,
  formatTaskMarkdown
};