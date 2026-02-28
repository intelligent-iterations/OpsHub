#!/usr/bin/env node
'use strict';

const SYNTHETIC_CHURN_PATTERNS = [
  /\bintegration dashboard task\b/i,
  /\bsmoke\b/i,
  /\blifecycle\b/i,
  /\bsynthetic\b/i,
  /\bchurn\b/i
];

const PANTRYPAL_PATTERNS = [
  /\bpantrypal\b/i,
  /\bpantry\b/i,
  /\brescue\b/i,
  /\bwaste\b/i,
  /\bexpiry\b/i
];

function normalizeText(value) {
  return String(value || '').trim();
}

function isSyntheticChurnTask(task = {}) {
  const text = [task.name, task.description, task.source].map(normalizeText).join(' ');
  return SYNTHETIC_CHURN_PATTERNS.some((rx) => rx.test(text));
}

function isPantryPalTask(task = {}) {
  const text = [task.name, task.description, task.source].map(normalizeText).join(' ');
  return PANTRYPAL_PATTERNS.some((rx) => rx.test(text));
}

function priorityWeight(priority) {
  if (priority === 'high') return 3;
  if (priority === 'low') return 1;
  return 2;
}

function scoreTask(task = {}) {
  const pantryPal = isPantryPalTask(task);
  const synthetic = isSyntheticChurnTask(task);
  let score = priorityWeight(task.priority);
  if (pantryPal) score += 3;
  if (synthetic) score -= 2;
  return {
    ...task,
    _guardrails: {
      pantryPal,
      synthetic,
      score
    }
  };
}

function prioritizeWithGuardrails(tasks = [], options = {}) {
  const syntheticCap = Number.isFinite(options.syntheticCap) ? Math.max(0, options.syntheticCap) : 2;
  const scored = tasks.map(scoreTask).sort((a, b) => b._guardrails.score - a._guardrails.score);

  const allowed = [];
  const quarantined = [];
  let syntheticCount = 0;

  for (const task of scored) {
    if (task._guardrails.synthetic) {
      syntheticCount += 1;
      if (syntheticCount > syntheticCap) {
        quarantined.push(task);
        continue;
      }
    }
    allowed.push(task);
  }

  return { prioritized: allowed, quarantined };
}

function computePantryPalWipMetrics(board, options = {}) {
  const threshold = Number.isFinite(options.threshold) ? options.threshold : 0.6;
  const minActiveWip = Number.isFinite(options.minActiveWip) ? options.minActiveWip : 3;
  const inProgress = Array.isArray(board?.columns?.inProgress) ? board.columns.inProgress : [];
  const pantryPalCount = inProgress.filter(isPantryPalTask).length;
  const total = inProgress.length;
  const share = total === 0 ? 0 : pantryPalCount / total;
  const driftAlert = total >= minActiveWip && share < threshold;

  return {
    threshold,
    minActiveWip,
    activeWipCount: total,
    pantryPalWipCount: pantryPalCount,
    pantryPalWipShare: Number(share.toFixed(4)),
    driftAlert,
    status: driftAlert ? 'alert' : 'ok'
  };
}

module.exports = {
  isSyntheticChurnTask,
  isPantryPalTask,
  prioritizeWithGuardrails,
  computePantryPalWipMetrics
};
