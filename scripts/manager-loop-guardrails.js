#!/usr/bin/env node
'use strict';

const { detectStaleInProgressTasks } = require('./inprogress-stale-cleanup');

const PASSIVE_WAIT_THRESHOLD = 0.15;
const BLOCKER_PROTOCOL_THRESHOLD = 0.95;
const ALLOWED_BLOCKER_ESCALATION_CATEGORIES = new Set(['permissions', 'sudo', 'auth', 'secrets', 'access']);

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
  const delegationSignals = activity.filter(
    (entry) => entry.type === 'task_moved' && entry.to === 'inProgress'
  ).length;
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

  return {
    pass: Object.values(checks).every((check) => check.pass),
    checks
  };
}

function summarizeManagerLoopReport(board, options = {}) {
  const metrics = computeManagerLoopMetrics(board, options);
  const thresholdEvaluation = evaluateManagerLoopThresholds(metrics);

  return {
    generatedAt: new Date().toISOString(),
    metrics,
    thresholdEvaluation
  };
}

module.exports = {
  computeManagerLoopMetrics,
  evaluateManagerLoopThresholds,
  summarizeManagerLoopReport,
  PASSIVE_WAIT_THRESHOLD,
  BLOCKER_PROTOCOL_THRESHOLD
};
