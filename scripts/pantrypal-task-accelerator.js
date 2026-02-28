#!/usr/bin/env node

const fs = require('node:fs');
const path = require('node:path');
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

  if (typeof experiment.externalDependency === 'object') {
    const name = String(
      experiment.externalDependency.name
      ?? experiment.externalDependency.dependency
      ?? experiment.externalDependency.id
      ?? ''
    ).trim();

    const metadata = [
      experiment.externalDependency.owner ? `owner: ${String(experiment.externalDependency.owner).trim()}` : '',
      experiment.externalDependency.eta ? `eta: ${String(experiment.externalDependency.eta).trim()}` : '',
      experiment.externalDependency.status ? `status: ${String(experiment.externalDependency.status).trim()}` : ''
    ].filter(Boolean);

    if (name && metadata.length) return [`External dependency: ${name} (${metadata.join(', ')})`];
    if (name) return [`External dependency: ${name}`];
    if (metadata.length) return [`External dependency: ${metadata.join(', ')}`];
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

function countReadyTasks(taskQueue = []) {
  return taskQueue.filter((task) => task && task.isReady !== false).length;
}

function isExecutionCapacityLight(taskQueue, threshold = 1) {
  return countReadyTasks(taskQueue) <= threshold;
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

  const readyLightThreshold = options.readyLightThreshold ?? 1;
  const queueIsLight = isQueueLight(queue, options.lightThreshold);
  const readyCapacityIsLight = isExecutionCapacityLight(queue, readyLightThreshold);

  if (options.autoSeed !== false && (queueIsLight || readyCapacityIsLight)) {
    const desiredQueueSize = Math.max(options.limit ?? 3, (options.lightThreshold ?? 2) + 1);
    const missingCount = Math.max(0, desiredQueueSize - queue.length);
    const readyTaskDeficit = Math.max(0, readyLightThreshold + 1 - countReadyTasks(queue));
    const computedSeedTarget = Math.max(missingCount, readyTaskDeficit);
    const requestedSeedTasks = Number.isFinite(options.seedMaxTasks) && options.seedMaxTasks > 0
      ? Math.floor(options.seedMaxTasks)
      : computedSeedTarget;
    const seeds = createAdaptiveSeedTasks(experiments, {
      validationCommand: options.validationCommand,
      maxTasks: requestedSeedTasks
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


function summarizeBlockedReasons(taskQueue, limit = 3) {
  const counts = new Map();

  for (const task of taskQueue) {
    for (const reason of task.blockedReasons || []) {
      const key = String(reason).trim();
      if (!key) continue;
      counts.set(key, (counts.get(key) || 0) + 1);
    }
  }

  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, limit)
    .map(([reason, count]) => ({ reason, count }));
}


function createTaskAcceptanceAudit(taskQueue, minimumCriteria = 6) {
  const normalizedMinimum = Number.isFinite(minimumCriteria) && minimumCriteria > 0
    ? Math.floor(minimumCriteria)
    : 6;

  const taskAudits = taskQueue.map((task) => {
    const criteriaCount = Array.isArray(task.acceptanceCriteria) ? task.acceptanceCriteria.length : 0;
    return {
      taskId: task.id,
      criteriaCount,
      meetsMinimum: criteriaCount >= normalizedMinimum
    };
  });

  const tasksBelowMinimum = taskAudits.filter((task) => !task.meetsMinimum).map((task) => task.taskId);
  const totalCriteria = taskAudits.reduce((sum, task) => sum + task.criteriaCount, 0);

  return {
    minimumCriteria: normalizedMinimum,
    averageCriteriaCount: taskAudits.length ? Number((totalCriteria / taskAudits.length).toFixed(2)) : 0,
    tasksBelowMinimum,
    tasksMeetingMinimum: taskAudits.length - tasksBelowMinimum.length
  };
}

function summarizeQueueScores(taskQueue = []) {
  const scores = taskQueue
    .map((task) => Number(task?.score))
    .filter((score) => Number.isFinite(score));

  if (!scores.length) {
    return {
      average: 0,
      median: 0,
      min: 0,
      max: 0,
      readyAverage: 0,
      blockedAverage: 0
    };
  }

  const sortedScores = [...scores].sort((a, b) => a - b);
  const midpoint = Math.floor(sortedScores.length / 2);
  const median = sortedScores.length % 2 === 0
    ? (sortedScores[midpoint - 1] + sortedScores[midpoint]) / 2
    : sortedScores[midpoint];

  const readyScores = taskQueue
    .filter((task) => task && task.isReady !== false)
    .map((task) => Number(task.score))
    .filter((score) => Number.isFinite(score));
  const blockedScores = taskQueue
    .filter((task) => task && task.isReady === false)
    .map((task) => Number(task.score))
    .filter((score) => Number.isFinite(score));

  const toAverage = (values) => values.length
    ? Number((values.reduce((sum, value) => sum + value, 0) / values.length).toFixed(2))
    : 0;

  return {
    average: toAverage(scores),
    median: Number(median.toFixed(2)),
    min: Number(sortedScores[0].toFixed(2)),
    max: Number(sortedScores[sortedScores.length - 1].toFixed(2)),
    readyAverage: toAverage(readyScores),
    blockedAverage: toAverage(blockedScores)
  };
}

function isExecutablePantryPalValidationCommand(command) {
  if (typeof command !== 'string') return false;

  const normalized = command.trim().toLowerCase();
  if (!normalized.includes('pantrypal')) return false;

  return /\b(node\s+--test|npm\s+test|npm\s+run\s+test[:\w-]*|pnpm\s+test|pnpm\s+run\s+test[:\w-]*|yarn\s+test|yarn\s+run\s+test[:\w-]*|bun\s+test|npx\s+vitest(?:\s+run)?)\b/.test(normalized);
}

function summarizeValidationCoverage(taskQueue = []) {
  const tasksWithValidation = taskQueue.filter((task) => typeof task?.validationCommand === 'string' && task.validationCommand.trim().length > 0);
  const executableValidations = tasksWithValidation.filter((task) => isExecutablePantryPalValidationCommand(task.validationCommand));

  const queueSize = taskQueue.length;
  const validationCoveragePct = queueSize
    ? Math.round((tasksWithValidation.length / queueSize) * 100)
    : 0;
  const executableValidationPct = queueSize
    ? Math.round((executableValidations.length / queueSize) * 100)
    : 0;

  return {
    tasksWithValidation: tasksWithValidation.length,
    executableValidations: executableValidations.length,
    validationCoveragePct,
    executableValidationPct
  };
}

function summarizeOwnerLoad(taskQueue = []) {
  const ownerCounts = new Map();

  for (const task of taskQueue) {
    const owner = typeof task?.owner === 'string' && task.owner.trim()
      ? task.owner.trim()
      : 'unassigned';

    if (!ownerCounts.has(owner)) {
      ownerCounts.set(owner, { owner, total: 0, ready: 0, blocked: 0, avgScore: 0, _scoreTotal: 0, _scoreCount: 0 });
    }

    const entry = ownerCounts.get(owner);
    entry.total += 1;
    if (task?.isReady === false) {
      entry.blocked += 1;
    } else {
      entry.ready += 1;
    }

    const score = Number(task?.score);
    if (Number.isFinite(score)) {
      entry._scoreTotal += score;
      entry._scoreCount += 1;
    }
  }

  return [...ownerCounts.values()]
    .map((entry) => ({
      owner: entry.owner,
      total: entry.total,
      ready: entry.ready,
      blocked: entry.blocked,
      avgScore: entry._scoreCount ? Number((entry._scoreTotal / entry._scoreCount).toFixed(2)) : 0
    }))
    .sort((a, b) => b.total - a.total || b.ready - a.ready || b.avgScore - a.avgScore || a.owner.localeCompare(b.owner));
}

function createQueueHealthSnapshot(experiments, queue, options = {}) {
  const minimumScore = options.minimumScore;
  const threshold = options.lightThreshold ?? 2;
  const readyLightThreshold = options.readyLightThreshold ?? 1;
  const ranked = rankExperiments(experiments);
  const aboveMinimum = typeof minimumScore === 'number'
    ? ranked.filter((experiment) => experiment.score >= minimumScore)
    : ranked;
  const readyTasks = countReadyTasks(queue);
  const blockedTasks = Math.max(0, queue.length - readyTasks);
  const readinessPct = queue.length ? Math.round((readyTasks / queue.length) * 100) : 0;
  const readyQueue = queue
    .filter((task) => task && task.isReady !== false)
    .sort((a, b) => (Number(b.score) || 0) - (Number(a.score) || 0));
  const topReadyTaskIds = readyQueue.slice(0, 3).map((task) => task.id);
  const topReadyScore = readyQueue.length ? Number(readyQueue[0].score) || 0 : 0;
  const topBlockedReasons = summarizeBlockedReasons(queue);
  const acceptanceAudit = createTaskAcceptanceAudit(queue, options.minimumCriteria);
  const scoreSummary = summarizeQueueScores(queue);
  const validationCoverage = summarizeValidationCoverage(queue);
  const ownerLoad = summarizeOwnerLoad(queue);

  return {
    incomingExperiments: experiments.length,
    eligibleExperiments: aboveMinimum.length,
    queueSize: queue.length,
    readyTasks,
    blockedTasks,
    readinessPct,
    topReadyTaskIds,
    topReadyScore,
    topBlockedReasons,
    scoreAverage: scoreSummary.average,
    scoreMedian: scoreSummary.median,
    scoreMin: scoreSummary.min,
    scoreMax: scoreSummary.max,
    scoreReadyAverage: scoreSummary.readyAverage,
    scoreBlockedAverage: scoreSummary.blockedAverage,
    isLight: isQueueLight(queue, threshold),
    isReadyCapacityLight: isExecutionCapacityLight(queue, readyLightThreshold),
    threshold,
    readyLightThreshold,
    minimumScore: typeof minimumScore === 'number' ? minimumScore : null,
    averageCriteriaCount: acceptanceAudit.averageCriteriaCount,
    minimumCriteria: acceptanceAudit.minimumCriteria,
    tasksMeetingMinimum: acceptanceAudit.tasksMeetingMinimum,
    tasksBelowCriteriaThreshold: acceptanceAudit.tasksBelowMinimum,
    tasksWithValidation: validationCoverage.tasksWithValidation,
    executableValidations: validationCoverage.executableValidations,
    validationCoveragePct: validationCoverage.validationCoveragePct,
    executableValidationPct: validationCoverage.executableValidationPct,
    ownerLoad,
    nextAction: blockedTasks > 0 && readyTasks === 0
      ? 'Resolve blockers or auto-seed fresh PantryPal experiments before launch.'
      : 'Execute top ready PantryPal experiment now and monitor first-hour guardrail.'
  };
}

function pickImmediateExecution(taskQueue, options = {}) {
  if (!taskQueue.length) return null;

  const minimumCriteria = Number.isFinite(options.minimumCriteria) && options.minimumCriteria > 0
    ? Math.floor(options.minimumCriteria)
    : 0;
  const readyTasks = taskQueue.filter((task) => task && task.isReady !== false);
  const top = readyTasks.find((task) => {
    const criteriaCount = Array.isArray(task.acceptanceCriteria) ? task.acceptanceCriteria.length : 0;
    return criteriaCount >= minimumCriteria;
  });

  if (!top) {
    const blockedReasons = [...new Set(taskQueue.flatMap((task) => task.blockedReasons || []))];
    if (readyTasks.length > 0 && minimumCriteria > 0) {
      blockedReasons.push(`No ready tasks meet minimum acceptance criteria (${minimumCriteria}).`);
    }

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
      `Top blockers: ${(health.topBlockedReasons || []).length ? health.topBlockedReasons.map((entry) => `${entry.reason} (${entry.count})`).join('; ') : 'none'}`,
      `Score summary: avg ${health.scoreAverage ?? 'n/a'}, median ${health.scoreMedian ?? 'n/a'}, min ${health.scoreMin ?? 'n/a'}, max ${health.scoreMax ?? 'n/a'}`,
      `Score by readiness: ready avg ${health.scoreReadyAverage ?? 'n/a'}, blocked avg ${health.scoreBlockedAverage ?? 'n/a'}`,
      `Acceptance criteria coverage: ${health.tasksMeetingMinimum ?? 'n/a'}/${health.queueSize ?? 'n/a'} tasks meet minimum ${health.minimumCriteria ?? 'n/a'} checks`,
      `Average criteria per task: ${health.averageCriteriaCount ?? 'n/a'}`,
      `Tasks below criteria threshold: ${(health.tasksBelowCriteriaThreshold || []).length}`,
      `Validation coverage: ${health.tasksWithValidation ?? 'n/a'}/${health.queueSize ?? 'n/a'} tasks (${health.validationCoveragePct ?? 'n/a'}%)`,
      `Executable validation commands: ${health.executableValidations ?? 'n/a'}/${health.queueSize ?? 'n/a'} tasks (${health.executableValidationPct ?? 'n/a'}%)`,
      `Owner load: ${(health.ownerLoad || []).length ? health.ownerLoad.map((entry) => `${entry.owner} total ${entry.total} (ready ${entry.ready}, blocked ${entry.blocked}, avg ${entry.avgScore})`).join('; ') : 'none'}`,
      `Queue light: ${health.isLight ? 'yes' : 'no'} (threshold: ${health.threshold})`,
      `Ready capacity light: ${health.isReadyCapacityLight ? 'yes' : 'no'} (threshold: ${health.readyLightThreshold ?? 1})`,
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
    sync: metadata.sync ?? null,
    health,
    queue: taskQueue,
    immediateExecution: executionPlan,
    validation: validationResult
  }, null, 2);
}

function writeExecutionBrief(filePath, executionPlan, validationResult, health, metadata = {}) {
  if (!filePath) return null;

  const resolvedPath = path.resolve(process.cwd(), filePath);
  const generatedAt = metadata.generatedAt ?? new Date().toISOString();

  const lines = [
    '# PantryPal Immediate Execution Brief',
    '',
    `Generated at: ${generatedAt}`,
    '',
    `Top task: ${executionPlan?.taskId ?? 'none'}${executionPlan?.title ? ` — ${executionPlan.title}` : ''}`,
    `Validation command: ${executionPlan?.validationCommand ?? 'n/a'}`,
    '',
    '## Critical acceptance checklist'
  ];

  const checklist = executionPlan?.acceptanceChecklist ?? [];
  if (!checklist.length) {
    lines.push('- No acceptance checklist available');
  } else {
    for (const criterion of checklist) {
      lines.push(`- [ ] ${criterion}`);
    }
  }

  lines.push('', '## First-hour launch steps');
  const launchSteps = executionPlan?.executionNow ?? [];
  if (!launchSteps.length) {
    lines.push('1. No launch steps available');
  } else {
    launchSteps.forEach((step, index) => {
      lines.push(`${index + 1}. ${step}`);
    });
  }

  lines.push('', '## Queue health');
  lines.push(`Ready tasks: ${health?.readyTasks ?? 'n/a'}`);
  lines.push(`Blocked tasks: ${health?.blockedTasks ?? 'n/a'}`);
  lines.push(`Readiness: ${health?.readinessPct ?? 'n/a'}%`);
  lines.push(`Top blockers: ${(health?.topBlockedReasons || []).length ? health.topBlockedReasons.map((entry) => `${entry.reason} (${entry.count})`).join('; ') : 'none'}`);
  lines.push(`Score summary: avg ${health?.scoreAverage ?? 'n/a'}, median ${health?.scoreMedian ?? 'n/a'}, min ${health?.scoreMin ?? 'n/a'}, max ${health?.scoreMax ?? 'n/a'}`);
  lines.push(`Score by readiness: ready avg ${health?.scoreReadyAverage ?? 'n/a'}, blocked avg ${health?.scoreBlockedAverage ?? 'n/a'}`);
  lines.push(`Acceptance criteria coverage: ${health?.tasksMeetingMinimum ?? 'n/a'}/${health?.queueSize ?? 'n/a'} tasks meet minimum ${health?.minimumCriteria ?? 'n/a'} checks`);
  lines.push(`Average criteria per task: ${health?.averageCriteriaCount ?? 'n/a'}`);
  lines.push(`Tasks below criteria threshold: ${(health?.tasksBelowCriteriaThreshold || []).length}`);
  lines.push(`Validation coverage: ${health?.tasksWithValidation ?? 'n/a'}/${health?.queueSize ?? 'n/a'} tasks (${health?.validationCoveragePct ?? 'n/a'}%)`);
  lines.push(`Executable validation commands: ${health?.executableValidations ?? 'n/a'}/${health?.queueSize ?? 'n/a'} tasks (${health?.executableValidationPct ?? 'n/a'}%)`);
  lines.push(`Owner load: ${(health?.ownerLoad || []).length ? health.ownerLoad.map((entry) => `${entry.owner} total ${entry.total} (ready ${entry.ready}, blocked ${entry.blocked}, avg ${entry.avgScore})`).join('; ') : 'none'}`);
  lines.push(`Next action: ${health?.nextAction ?? 'n/a'}`);

  lines.push('', '## Validation result');
  lines.push(`Status: ${validationResult?.status ?? 'NOT_RUN'}`);
  lines.push(`Exit code: ${validationResult?.exitCode ?? 'n/a'}`);
  lines.push('```');
  lines.push(validationResult?.outputSnippet ?? 'n/a');
  lines.push('```', '');

  fs.writeFileSync(resolvedPath, `${lines.join('\n')}\n`, 'utf8');

  return {
    filePath,
    generatedAt,
    taskId: executionPlan?.taskId ?? null
  };
}

function parseCliOptions(argv = []) {
  const options = {
    outputFormat: argv.includes('--json') ? 'json' : 'markdown',
    limit: 3,
    minimumScore: 75,
    lightThreshold: 2,
    readyLightThreshold: 1,
    minimumCriteria: 6,
    validate: !argv.includes('--no-validate'),
    validationTimeoutMs: null,
    experimentsFile: null,
    defaultOwner: 'growth-oncall',
    validationCommand: null,
    executionBriefOut: null,
    syncKanban: false,
    kanbanFile: null,
    readyOnlySync: false,
    bootstrapKanban: false,
    seedMaxTasks: null,
    autoSeed: true
  };

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith('--')) continue;

    const [rawFlag, rawValue] = token.split('=');
    const value = rawValue ?? argv[index + 1];

    const integerFlagMap = {
      '--limit': 'limit',
      '--light-threshold': 'lightThreshold',
      '--ready-light-threshold': 'readyLightThreshold',
      '--minimum-criteria': 'minimumCriteria',
      '--seed-max-tasks': 'seedMaxTasks',
      '--validation-timeout-ms': 'validationTimeoutMs'
    };

    if (rawFlag in integerFlagMap) {
      const parsedValue = Number.parseInt(value, 10);
      if (Number.isFinite(parsedValue) && parsedValue > 0) {
        options[integerFlagMap[rawFlag]] = parsedValue;
        if (rawValue === undefined) index += 1;
      }
      continue;
    }

    if (rawFlag === '--minimum-score') {
      const parsedValue = Number.parseFloat(value);
      if (Number.isFinite(parsedValue) && parsedValue > 0) {
        options.minimumScore = parsedValue;
        if (rawValue === undefined) index += 1;
      }
      continue;
    }

    const stringFlagMap = {
      '--experiments-file': 'experimentsFile',
      '--default-owner': 'defaultOwner',
      '--validation-command': 'validationCommand',
      '--execution-brief-out': 'executionBriefOut',
      '--kanban-file': 'kanbanFile'
    };

    if (rawFlag in stringFlagMap && typeof value === 'string' && value.trim()) {
      options[stringFlagMap[rawFlag]] = value.trim();
      if (rawValue === undefined) index += 1;
    }

    if (rawFlag === '--sync-kanban') {
      options.syncKanban = true;
    }

    if (rawFlag === '--ready-only-sync') {
      options.readyOnlySync = true;
    }

    if (rawFlag === '--bootstrap-kanban') {
      options.bootstrapKanban = true;
    }

    if (rawFlag === '--no-auto-seed') {
      options.autoSeed = false;
    }
  }

  return options;
}

function loadExperimentsFromFile(filePath) {
  const resolvedPath = path.resolve(process.cwd(), filePath);
  const raw = fs.readFileSync(resolvedPath, 'utf8');
  const parsed = JSON.parse(raw);

  if (!Array.isArray(parsed)) {
    throw new Error(`Expected an array of experiments in ${resolvedPath}`);
  }

  return parsed;
}

function upsertQueueIntoKanban(taskQueue, kanban, options = {}) {
  const normalized = kanban && typeof kanban === 'object' ? { ...kanban } : {};
  const columns = normalized.columns && typeof normalized.columns === 'object' ? normalized.columns : {};
  const todo = Array.isArray(columns.todo) ? [...columns.todo] : [];
  const activityLog = Array.isArray(normalized.activityLog) ? [...normalized.activityLog] : [];
  const source = options.source ?? 'pantrypal-task-accelerator';
  const now = options.now ?? new Date().toISOString();

  const existingTaskIds = new Set(todo.map((task) => task && task.id).filter(Boolean));
  let inserted = 0;

  for (const queueTask of taskQueue) {
    if (!queueTask || !queueTask.id || existingTaskIds.has(queueTask.id)) continue;
    const descriptionLines = [
      `Score: ${Number(queueTask.score).toFixed(2)}`,
      `Owner: ${queueTask.owner}`,
      `Validation: ${queueTask.validationCommand}`,
      '',
      'Acceptance criteria:',
      ...(queueTask.acceptanceCriteria || []).map((criterion, index) => `${index + 1}. ${criterion}`)
    ];

    if (Array.isArray(queueTask.blockedReasons) && queueTask.blockedReasons.length) {
      descriptionLines.push('', 'Blocked reasons:', ...queueTask.blockedReasons.map((reason) => `- ${reason}`));
    }

    todo.push({
      id: queueTask.id,
      name: `[PantryPal] ${queueTask.title}`,
      description: descriptionLines.join('\n'),
      priority: queueTask.score >= 85 ? 'high' : queueTask.score >= 75 ? 'medium' : 'low',
      status: 'todo',
      createdAt: now,
      completedAt: null,
      source,
      metadata: {
        score: queueTask.score,
        owner: queueTask.owner,
        validationCommand: queueTask.validationCommand,
        isReady: queueTask.isReady !== false
      }
    });
    existingTaskIds.add(queueTask.id);
    inserted += 1;

    activityLog.unshift({
      at: now,
      type: 'task_added',
      taskId: queueTask.id,
      taskName: `[PantryPal] ${queueTask.title}`,
      to: 'todo',
      detail: `Added task from ${source}`
    });
  }

  return {
    inserted,
    kanban: {
      ...normalized,
      columns: {
        ...columns,
        todo
      },
      activityLog
    }
  };
}

function syncQueueToKanban(taskQueue, options = {}) {
  if (!options.kanbanFile) {
    return { synced: false, inserted: 0, reason: 'No kanban file configured.' };
  }

  const readyOnly = options.readyOnly === true;
  const sourceQueue = readyOnly
    ? taskQueue.filter((task) => task && task.isReady !== false)
    : taskQueue;
  const skippedBlocked = Math.max(0, taskQueue.length - sourceQueue.length);

  const resolvedPath = path.resolve(process.cwd(), options.kanbanFile);
  const bootstrapTemplate = {
    columns: {
      todo: [],
      inProgress: [],
      done: []
    },
    activityLog: []
  };

  let kanban;
  if (!fs.existsSync(resolvedPath)) {
    if (!options.bootstrapKanban) {
      throw new Error(`Kanban file not found at ${resolvedPath}. Re-run with --bootstrap-kanban to create it.`);
    }
    kanban = bootstrapTemplate;
  } else {
    const raw = fs.readFileSync(resolvedPath, 'utf8');
    kanban = JSON.parse(raw);
  }

  const result = upsertQueueIntoKanban(sourceQueue, kanban, {
    source: options.source,
    now: options.now
  });

  const bootstrapped = !fs.existsSync(resolvedPath);
  if (result.inserted > 0 || bootstrapped) {
    fs.writeFileSync(resolvedPath, `${JSON.stringify(result.kanban, null, 2)}\n`, 'utf8');
  }

  return {
    synced: true,
    inserted: result.inserted,
    attempted: sourceQueue.length,
    skippedBlocked,
    readyOnly,
    bootstrapped,
    kanbanFile: options.kanbanFile
  };
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

  const cliOptions = parseCliOptions(process.argv.slice(2));

  if (cliOptions.experimentsFile) {
    experiments = loadExperimentsFromFile(cliOptions.experimentsFile);
  }

  const { queue, seeded } = buildQueueWithAutoSeed(experiments, {
    defaultOwner: cliOptions.defaultOwner,
    limit: cliOptions.limit,
    minimumScore: cliOptions.minimumScore,
    lightThreshold: cliOptions.lightThreshold,
    readyLightThreshold: cliOptions.readyLightThreshold,
    validationCommand: cliOptions.validationCommand,
    seedMaxTasks: cliOptions.seedMaxTasks,
    autoSeed: cliOptions.autoSeed
  });

  const executionPlan = pickImmediateExecution(queue, {
    minimumCriteria: cliOptions.minimumCriteria
  });
  const validationResult = cliOptions.validate
    ? runValidationCommand(executionPlan?.validationCommand, {
      timeoutMs: cliOptions.validationTimeoutMs ?? undefined
    })
    : {
      status: 'NOT_RUN',
      command: executionPlan?.validationCommand ?? null,
      exitCode: null,
      durationMs: 0,
      outputSnippet: 'Skipped by --no-validate flag.'
    };
  const health = createQueueHealthSnapshot(experiments, queue, {
    minimumScore: cliOptions.minimumScore,
    lightThreshold: cliOptions.lightThreshold,
    readyLightThreshold: cliOptions.readyLightThreshold,
    minimumCriteria: cliOptions.minimumCriteria
  });

  const syncResult = cliOptions.syncKanban
    ? syncQueueToKanban(queue, {
      kanbanFile: cliOptions.kanbanFile,
      source: 'pantrypal-task-accelerator',
      readyOnly: cliOptions.readyOnlySync,
      bootstrapKanban: cliOptions.bootstrapKanban
    })
    : { synced: false, inserted: 0, reason: 'Sync disabled.' };

  const executionBrief = cliOptions.executionBriefOut
    ? writeExecutionBrief(cliOptions.executionBriefOut, executionPlan, validationResult, health)
    : null;

  const output = cliOptions.outputFormat === 'json'
    ? formatTaskJson(queue, executionPlan, validationResult, { seeded, sync: syncResult, executionBrief }, health)
    : formatTaskMarkdown(queue, executionPlan, validationResult, health);

  process.stdout.write(output);
}

module.exports = {
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
};