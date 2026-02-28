#!/usr/bin/env node
'use strict';

const { detectStaleInProgressTasks } = require('./inprogress-stale-cleanup');

const PASSIVE_WAIT_THRESHOLD = 0.15;
const BLOCKER_PROTOCOL_THRESHOLD = 0.95;
const ALLOWED_BLOCKER_ESCALATION_CATEGORIES = new Set(['permissions', 'sudo', 'auth', 'secrets', 'access']);
const DEFAULT_NEXT_ACTION_COOLDOWN_MS = 5 * 60 * 1000;
const DEFAULT_NEXT_ACTION_SLA_MINUTES = 3;

function normalizeBoard(board = {}) {
  return {
    columns: {
      backlog: Array.isArray(board?.columns?.backlog) ? board.columns.backlog : [],
      todo: Array.isArray(board?.columns?.todo) ? board.columns.todo : [],
      inProgress: Array.isArray(board?.columns?.inProgress) ? board.columns.inProgress : [],
      done: Array.isArray(board?.columns?.done) ? board.columns.done : []
    },
    activityLog: Array.isArray(board?.activityLog) ? board.activityLog : []
  };
}

function isDoneWithEvidence(task = {}) {
  return task.status === 'done' && /https:\/\/github\.com\//i.test(String(task.completionDetails || '')) && Boolean(task.verification);
}

function parseBlockerRecord(task = {}) {
  const metadata = task.metadata || {};
  const blocker = task.blocker || metadata.blocker || {};
  const detected = Boolean(
    blocker.detected ||
      task.blockerDetected ||
      metadata.blockerDetected ||
      (Array.isArray(blocker.repairAttempts) && blocker.repairAttempts.length > 0)
  );

  const repairAttempts = Array.isArray(blocker.repairAttempts)
    ? blocker.repairAttempts
    : Array.isArray(metadata.repairAttempts)
      ? metadata.repairAttempts
      : [];

  const escalationCategory = String(
    blocker.escalationCategory || metadata.escalationCategory || task.escalationCategory || ''
  ).toLowerCase();

  const compliant =
    !detected ||
    (repairAttempts.length >= 2 && (!escalationCategory || ALLOWED_BLOCKER_ESCALATION_CATEGORIES.has(escalationCategory)));

  return { detected, repairAttempts: repairAttempts.length, escalationCategory, compliant };
}

function hasRecentAutoDispatch(activity = [], nowMs, cooldownMs) {
  return activity.some((entry) => {
    if (entry?.type !== 'next_action_scheduled') return false;
    const atMs = Date.parse(entry?.at || '');
    return Number.isFinite(atMs) && nowMs - atMs <= cooldownMs;
  });
}

function pickNextActionTask(columns = {}) {
  if (Array.isArray(columns.todo) && columns.todo.length > 0) return { from: 'todo', index: 0, task: columns.todo[0] };
  if (Array.isArray(columns.backlog) && columns.backlog.length > 0) return { from: 'backlog', index: 0, task: columns.backlog[0] };
  return null;
}

function applyAutoNextActionScheduler(board, options = {}) {
  const normalized = normalizeBoard(board);
  const staleMinutes = Number.isFinite(options.staleMinutes) ? options.staleMinutes : 20;
  const nowMs = Number.isFinite(options.nowMs) ? options.nowMs : Date.now();
  const cooldownMs = Number.isFinite(options.cooldownMs) ? options.cooldownMs : DEFAULT_NEXT_ACTION_COOLDOWN_MS;
  const slaMinutes = Number.isFinite(options.slaMinutes) ? options.slaMinutes : DEFAULT_NEXT_ACTION_SLA_MINUTES;

  const staleSignals = detectStaleInProgressTasks(normalized, {
    staleMinutes,
    nowMs,
    activeSessions: Array.isArray(options.activeSessions) ? options.activeSessions : []
  });
  const stalledWorkers = staleSignals.filter((item) => item.stalledWorker).length;
  if (stalledWorkers === 0) return { board: normalized, changed: false, reason: 'no_stalled_workers', dispatchedTaskId: null };

  if (hasRecentAutoDispatch(normalized.activityLog, nowMs, cooldownMs)) {
    return { board: normalized, changed: false, reason: 'cooldown_active', dispatchedTaskId: null };
  }

  const candidate = pickNextActionTask(normalized.columns);
  if (!candidate) return { board: normalized, changed: false, reason: 'no_candidate_task', dispatchedTaskId: null };

  const [task] = normalized.columns[candidate.from].splice(candidate.index, 1);
  task.status = 'inProgress';
  task.completedAt = null;
  task.nextActionScheduledAt = new Date(nowMs).toISOString();
  task.nextActionDispatchBy = new Date(nowMs + slaMinutes * 60 * 1000).toISOString();

  normalized.columns.inProgress.unshift(task);
  normalized.activityLog.unshift({
    at: new Date(nowMs).toISOString(),
    type: 'task_moved',
    taskId: task.id,
    taskName: task.name,
    from: candidate.from,
    to: 'inProgress',
    detail: `Auto-next-action dispatch due to passive wait (${stalledWorkers} stalled worker(s)); SLA ${slaMinutes}m.`
  });
  normalized.activityLog.unshift({
    at: new Date(nowMs).toISOString(),
    type: 'next_action_scheduled',
    taskId: task.id,
    taskName: task.name,
    from: candidate.from,
    to: 'inProgress',
    detail: `Scheduler dispatched next action with ${Math.round(cooldownMs / 60000)}m cooldown.`
  });

  return { board: normalized, changed: true, reason: 'dispatched', dispatchedTaskId: task.id, stalledWorkers };
}

function computeManagerLoopMetrics(board, options = {}) {
  const normalized = normalizeBoard(board);
  const staleMinutes = Number.isFinite(options.staleMinutes) ? options.staleMinutes : 20;
  const nowMs = Number.isFinite(options.nowMs) ? options.nowMs : Date.now();
  const inProgress = normalized.columns.inProgress;

  const staleSignals = detectStaleInProgressTasks(normalized, {
    staleMinutes,
    nowMs,
    activeSessions: Array.isArray(options.activeSessions) ? options.activeSessions : []
  });
  const stalledWorkers = staleSignals.filter((item) => item.stalledWorker).length;
  const passiveWaitRatio = inProgress.length ? Number((stalledWorkers / inProgress.length).toFixed(4)) : 0;

  const activity = normalized.activityLog;
  const delegationSignals = activity.filter((entry) => entry.type === 'task_moved' && entry.to === 'inProgress').length;
  const actionableSignals = Math.max(
    delegationSignals,
    activity.filter((entry) => entry.type === 'task_added' || entry.type === 'task_moved').length
  );
  const delegationRate = actionableSignals ? Number((delegationSignals / actionableSignals).toFixed(4)) : 0;

  const doneTasks = normalized.columns.done;
  const doneWithEvidence = doneTasks.filter(isDoneWithEvidence).length;
  const evidenceCompletionRate = doneTasks.length ? Number((doneWithEvidence / doneTasks.length).toFixed(4)) : 1;

  const blockerRecords = doneTasks.map(parseBlockerRecord).filter((record) => record.detected);
  const blockerProtocolCompliance = blockerRecords.length
    ? Number((blockerRecords.filter((record) => record.compliant).length / blockerRecords.length).toFixed(4))
    : 1;

  return {
    passiveWaitRatio,
    delegationRate,
    evidenceCompletionRate,
    blockerProtocolCompliance,
    stalledWorkers,
    activeInProgressCount: inProgress.length,
    thresholds: {
      passiveWaitRatioMax: PASSIVE_WAIT_THRESHOLD,
      blockerProtocolComplianceMin: BLOCKER_PROTOCOL_THRESHOLD
    }
  };
}

function evaluateManagerLoopThresholds(metrics = {}) {
  const checks = {
    passiveWaitRatio: {
      value: Number(metrics.passiveWaitRatio || 0),
      threshold: PASSIVE_WAIT_THRESHOLD,
      operator: '<=',
      pass: Number(metrics.passiveWaitRatio || 0) <= PASSIVE_WAIT_THRESHOLD
    },
    blockerProtocolCompliance: {
      value: Number(metrics.blockerProtocolCompliance || 0),
      threshold: BLOCKER_PROTOCOL_THRESHOLD,
      operator: '>=',
      pass: Number(metrics.blockerProtocolCompliance || 0) >= BLOCKER_PROTOCOL_THRESHOLD
    }
  };

  return { pass: Object.values(checks).every((check) => check.pass), checks };
}

function summarizeManagerLoopReport(board, options = {}) {
  const metrics = computeManagerLoopMetrics(board, options);
  const thresholdEvaluation = evaluateManagerLoopThresholds(metrics);
  return { generatedAt: new Date().toISOString(), metrics, thresholdEvaluation };
}

module.exports = {
  applyAutoNextActionScheduler,
  computeManagerLoopMetrics,
  evaluateManagerLoopThresholds,
  summarizeManagerLoopReport,
  PASSIVE_WAIT_THRESHOLD,
  BLOCKER_PROTOCOL_THRESHOLD,
  DEFAULT_NEXT_ACTION_COOLDOWN_MS,
  DEFAULT_NEXT_ACTION_SLA_MINUTES
};