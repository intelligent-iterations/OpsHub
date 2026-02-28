#!/usr/bin/env node

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
  const guardrail = experiment.guardrail ?? 'unsubscribe rate does not increase by >1%';

  return [
    `Experiment spec includes hypothesis, segment, channel, and success metric (${metric}).`,
    `A/B test is configured with event instrumentation and minimum detectable lift target of ${targetLift}% .`,
    `Guardrail is monitored and passes: ${guardrail}.`,
    'Decision log is updated with launch date, owner, and rollback trigger.'
  ];
}

function buildTaskQueue(experiments, options = {}) {
  const limit = options.limit ?? 3;
  const ranked = rankExperiments(experiments);

  return ranked.slice(0, limit).map((experiment, index) => ({
    id: `PP-GROWTH-${String(index + 1).padStart(3, '0')}-${toSlug(experiment.name)}`,
    title: experiment.name,
    score: experiment.score,
    owner: options.defaultOwner ?? 'growth-oncall',
    acceptanceCriteria: createAcceptanceCriteria(experiment)
  }));
}

function pickImmediateExecution(taskQueue) {
  if (!taskQueue.length) return null;

  const [top] = taskQueue;
  return {
    taskId: top.id,
    title: top.title,
    executionNow: [
      'Draft experiment brief in tracker.',
      'Prepare treatment/control variants and QA events in staging.',
      'Launch to 10% holdout split and monitor first-hour guardrail.'
    ]
  };
}

function formatTaskMarkdown(taskQueue, executionPlan) {
  const taskLines = taskQueue.map((task) => {
    const criteria = task.acceptanceCriteria.map((line) => `    - [ ] ${line}`).join('\n');
    return `- [ ] ${task.id} — ${task.title} (score: ${task.score.toFixed(2)}, owner: ${task.owner})\n  - Acceptance criteria:\n${criteria}`;
  }).join('\n');

  const executionLines = executionPlan
    ? executionPlan.executionNow.map((step, idx) => `${idx + 1}. ${step}`).join('\n')
    : '1. No tasks available';

  return [
    '# PantryPal Task Queue (Auto-generated)',
    '',
    taskLines,
    '',
    '## Execute Immediately',
    executionPlan ? `Top task: ${executionPlan.taskId} — ${executionPlan.title}` : 'Top task: none',
    executionLines,
    ''
  ].join('\n');
}

if (require.main === module) {
  const experiments = [
    {
      name: 'Personalized rescue recipes from expiring inventory',
      impact: 0.89,
      confidence: 0.7,
      ease: 0.62,
      pantryPalFit: 0.98,
      primaryMetric: 'weekly meal-plan saves',
      targetLiftPct: 12,
      guardrail: 'recipe dismiss rate stays below 20%'
    },
    {
      name: 'Referral booster after first successful pantry save',
      impact: 0.67,
      confidence: 0.66,
      ease: 0.85,
      pantryPalFit: 0.8
    },
    {
      name: 'Household challenge leaderboard for waste reduction streaks',
      impact: 0.8,
      confidence: 0.58,
      ease: 0.54,
      pantryPalFit: 0.9
    }
  ];

  const queue = buildTaskQueue(experiments, { defaultOwner: 'growth-oncall', limit: 3 });
  const executionPlan = pickImmediateExecution(queue);
  process.stdout.write(formatTaskMarkdown(queue, executionPlan));
}

module.exports = {
  toSlug,
  createAcceptanceCriteria,
  buildTaskQueue,
  pickImmediateExecution,
  formatTaskMarkdown
};
