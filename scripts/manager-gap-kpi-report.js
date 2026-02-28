#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const { summarizeManagerLoopReport, computeManagerLoopMetrics } = require('./manager-loop-guardrails');

function parseArgs(argv) {
  const args = {
    kanban: path.resolve(__dirname, '..', 'data', 'kanban.json'),
    jsonOut: path.resolve(__dirname, '..', 'artifacts', 'mgap-kpi-report.json'),
    mdOut: path.resolve(__dirname, '..', 'artifacts', 'mgap-kpi-report.md')
  };

  for (let i = 2; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === '--kanban') args.kanban = path.resolve(argv[++i]);
    else if (token === '--json-out') args.jsonOut = path.resolve(argv[++i]);
    else if (token === '--md-out') args.mdOut = path.resolve(argv[++i]);
  }

  return args;
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function splitActivityWindows(board) {
  const activity = Array.isArray(board?.activityLog) ? [...board.activityLog].reverse() : [];
  const splitIndex = Math.floor(activity.length / 2);
  return {
    before: activity.slice(0, splitIndex),
    after: activity.slice(splitIndex)
  };
}

function markdown(report) {
  return `# MGAP KPI Report\n\nGenerated: ${report.generatedAt}\n\n## Current metrics\n- passiveWaitRatio: **${report.current.metrics.passiveWaitRatio}**\n- delegationRate: **${report.current.metrics.delegationRate}**\n- evidenceCompletionRate: **${report.current.metrics.evidenceCompletionRate}**\n- blockerProtocolCompliance: **${report.current.metrics.blockerProtocolCompliance}**\n\n## Threshold checks\n- passiveWaitRatio <= 0.15: **${report.current.thresholdEvaluation.checks.passiveWaitRatio.pass ? 'PASS' : 'FAIL'}**\n- blockerProtocolCompliance >= 0.95: **${report.current.thresholdEvaluation.checks.blockerProtocolCompliance.pass ? 'PASS' : 'FAIL'}**\n\n## Before vs after windows (kanban + activity log split)\n- before.passiveWaitRatio: ${report.before.metrics.passiveWaitRatio}\n- after.passiveWaitRatio: ${report.after.metrics.passiveWaitRatio}\n- passiveWaitRatio reduction: ${report.deltas.passiveWaitRatioReduction}\n- before.blockerProtocolCompliance: ${report.before.metrics.blockerProtocolCompliance}\n- after.blockerProtocolCompliance: ${report.after.metrics.blockerProtocolCompliance}\n- blockerProtocolCompliance lift: ${report.deltas.blockerProtocolComplianceLift}\n\n## Activity-window context\n- before window entries: ${report.windows.beforeCount}\n- after window entries: ${report.windows.afterCount}\n`; 
}

function main() {
  const args = parseArgs(process.argv);
  const board = readJson(args.kanban);
  const windows = splitActivityWindows(board);
  const beforeMetrics = computeManagerLoopMetrics({ ...board, activityLog: windows.before });
  const afterMetrics = computeManagerLoopMetrics({ ...board, activityLog: windows.after });

  const report = {
    generatedAt: new Date().toISOString(),
    windows: {
      beforeCount: windows.before.length,
      afterCount: windows.after.length
    },
    current: summarizeManagerLoopReport(board),
    before: { metrics: beforeMetrics },
    after: { metrics: afterMetrics },
    deltas: {
      passiveWaitRatioReduction: Number((beforeMetrics.passiveWaitRatio - afterMetrics.passiveWaitRatio).toFixed(4)),
      blockerProtocolComplianceLift: Number((afterMetrics.blockerProtocolCompliance - beforeMetrics.blockerProtocolCompliance).toFixed(4))
    }
  };

  fs.mkdirSync(path.dirname(args.jsonOut), { recursive: true });
  fs.mkdirSync(path.dirname(args.mdOut), { recursive: true });
  fs.writeFileSync(args.jsonOut, JSON.stringify(report, null, 2), 'utf8');
  fs.writeFileSync(args.mdOut, markdown(report), 'utf8');
  console.log(JSON.stringify({ ok: true, jsonOut: args.jsonOut, mdOut: args.mdOut }));
}

if (require.main === module) main();
