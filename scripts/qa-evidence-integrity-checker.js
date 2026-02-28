#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const { validateHumanFacingUpdate, findGitHubUrls } = require('../lib/human-deliverable-guard');

function parseNonNegativeInteger(value, flagName) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || Number.isNaN(parsed) || parsed < 0) {
    throw new Error(`${flagName} requires a non-negative integer, received: ${value}`);
  }
  return parsed;
}

function parseArgs(argv) {
  const args = {
    kanban: path.resolve(__dirname, '..', 'data', 'kanban.json'),
    artifactsDir: path.resolve(__dirname, '..', '..', 'artifacts'),
    jsonOut: null,
    mdOut: null,
    failOnIssues: false,
    maxErrors: Number.POSITIVE_INFINITY,
    maxWarnings: Number.POSITIVE_INFINITY,
    topFailures: 0,
    applyRollback: false
  };

  for (let i = 2; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === '--kanban') args.kanban = path.resolve(argv[++i]);
    else if (token === '--artifacts-dir') args.artifactsDir = path.resolve(argv[++i]);
    else if (token === '--json-out') args.jsonOut = path.resolve(argv[++i]);
    else if (token === '--md-out') args.mdOut = path.resolve(argv[++i]);
    else if (token === '--fail-on-issues') args.failOnIssues = true;
    else if (token === '--max-errors') args.maxErrors = parseNonNegativeInteger(argv[++i], '--max-errors');
    else if (token === '--max-warnings') args.maxWarnings = parseNonNegativeInteger(argv[++i], '--max-warnings');
    else if (token === '--top-failures') args.topFailures = parseNonNegativeInteger(argv[++i], '--top-failures');
    else if (token === '--apply-rollback') args.applyRollback = true;
    else if (token === '--help' || token === '-h') {
      printHelp();
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${token}`);
    }
  }

  return args;
}

function printHelp() {
  console.log(`qa-evidence-integrity-checker\n\nUsage:\n  node scripts/qa-evidence-integrity-checker.js [options]\n\nOptions:\n  --kanban <path>         Path to kanban.json (default: OpsHub/data/kanban.json)\n  --artifacts-dir <path>  Artifacts directory root (default: ../artifacts)\n  --json-out <path>       Write JSON report to file\n  --md-out <path>         Write markdown report to file\n  --fail-on-issues        Exit with code 1 if any task fails checks\n  --max-errors <n>        Exit with code 1 if total errors exceed n\n  --max-warnings <n>      Exit with code 1 if total warnings exceed n\n  --top-failures <n>      Include top n failing tasks in remediation summary\n  --apply-rollback        Move failing done tasks back to inProgress with activity log reason\n  -h, --help              Show help`);
}

function safeReadJson(filePath) {
  const raw = fs.readFileSync(filePath, 'utf8');
  return JSON.parse(raw);
}

function uniq(list) {
  return [...new Set(list.filter(Boolean))];
}

function extractEvidenceLinks(text) {
  if (!text) return [];
  const links = [];
  const mdLinkRegex = /\[[^\]]+\]\(([^)]+)\)/g;
  let match;
  while ((match = mdLinkRegex.exec(text)) !== null) links.push(match[1].trim());

  const labelRegex = /\b(?:evidence|artifact|artifacts|screenshot|screenshots|doc|docs)\s*:\s*([^\n]+)/gi;
  while ((match = labelRegex.exec(text)) !== null) {
    const parts = match[1].split(/[;,]/).map((p) => p.trim()).filter(Boolean);
    links.push(...parts);
  }

  const bareRegex = /(?:https?:\/\/\S+|\bartifacts\/[\w./-]+|\bpantrypal\/[\w./-]+|\bOpsHub\/[\w./-]+)/g;
  while ((match = bareRegex.exec(text)) !== null) links.push(match[0].trim());

  return uniq(links.map((l) => l.replace(/[).,]+$/, '').trim()));
}

function looksLikeScreenshot(ref) {
  return /screenshot|screen-shot|\.png$|\.jpe?g$|\.webp$|\.gif$/i.test(ref);
}

function normalizeCandidatePaths(ref, kanbanDir, artifactsDir) {
  const candidates = [];
  if (/^https?:\/\//i.test(ref)) return candidates;
  const cleaned = ref.replace(/^\.?\//, '');
  candidates.push(path.resolve(kanbanDir, ref));
  candidates.push(path.resolve(kanbanDir, cleaned));
  if (cleaned.startsWith('artifacts/')) {
    candidates.push(path.resolve(artifactsDir, cleaned.replace(/^artifacts\//, '')));
  } else {
    candidates.push(path.resolve(artifactsDir, cleaned));
  }
  candidates.push(path.resolve(path.dirname(kanbanDir), cleaned));
  return uniq(candidates);
}

function existsAny(paths) {
  return paths.some((p) => fs.existsSync(p));
}

function detectCorrectionOccurred(task) {
  return Boolean(
    task?.metadata?.correctionRequired ||
      task?.metadata?.correctionOccurred ||
      (Number(task?.metadata?.correctionCount) || 0) > 0 ||
      task?.correctionRequired ||
      task?.correctionOccurred
  );
}

function hasCorrectionLog(task) {
  return Boolean(
    task?.metadata?.correctionLog ||
      (Array.isArray(task?.metadata?.correctionEntries) && task.metadata.correctionEntries.length > 0) ||
      task?.correctionLog
  );
}

function hasVerificationRecord(task) {
  return Boolean(task?.metadata?.verification || task?.verification || task?.verifiedAt || task?.metadata?.verifiedAt);
}

function checkTask(task, context) {
  const description = String(task.description || '');
  const completionDetails = String(task.completionDetails || task?.metadata?.completionDetails || '');
  const evidenceRefs = extractEvidenceLinks(`${description}\n${completionDetails}`);
  const screenshotRefs = evidenceRefs.filter(looksLikeScreenshot);
  const hasEvidenceRef = evidenceRefs.length > 0;
  const hasScreenshotRef = screenshotRefs.length > 0;
  const issues = [];

  if (!hasEvidenceRef) {
    issues.push({
      severity: 'error',
      code: 'MISSING_EVIDENCE_LINK',
      message: 'Done task has no evidence links/refs in description or completionDetails.',
      remediation: 'Add `Evidence:` with artifact/doc links in task completionDetails.'
    });
  }

  const gate = validateHumanFacingUpdate({ text: `${description}\n${completionDetails}`, requireGitHubEvidence: true });
  const githubEvidenceUrls = findGitHubUrls(`${description}\n${completionDetails}`);

  for (const gateIssue of gate.issues) {
    issues.push({
      severity: 'error',
      code: gateIssue.code,
      message: gateIssue.message,
      remediation:
        gateIssue.code === 'LOCAL_PATH_LEAK'
          ? 'Remove local filesystem paths and replace with https://github.com/... links.'
          : 'Include at least one https://github.com/... URL in completionDetails before Done.',
      refs: gateIssue.refs || []
    });
  }

  if (!hasScreenshotRef) {
    issues.push({
      severity: 'warn',
      code: 'MISSING_SCREENSHOT_REFERENCE',
      message: 'Done task does not reference screenshot artifact (.png/.jpg/etc).',
      remediation: 'Attach and reference at least one screenshot artifact path under artifacts/.'
    });
  }

  const correctionOccurred = detectCorrectionOccurred(task);
  if (correctionOccurred && !hasCorrectionLog(task)) {
    issues.push({
      severity: 'error',
      code: 'MISSING_CORRECTION_LOG',
      message: 'Task indicates a correction occurred but no correction log record exists.',
      remediation: 'Add metadata.correctionLog with reason/remediation before Done.'
    });
  }

  if (!hasVerificationRecord(task)) {
    issues.push({
      severity: 'error',
      code: 'MISSING_VERIFICATION_RECORD',
      message: 'Done task has no verification record.',
      remediation: 'Add metadata.verification (command, result, verifiedAt) before Done.'
    });
  }

  const missingArtifactRefs = [];
  for (const ref of evidenceRefs.filter((r) => !/^https?:\/\//i.test(r))) {
    const candidates = normalizeCandidatePaths(ref, context.kanbanDir, context.artifactsDir);
    if (!existsAny(candidates)) missingArtifactRefs.push(ref);
  }

  if (missingArtifactRefs.length > 0) {
    issues.push({
      severity: 'error',
      code: 'ARTIFACT_REFERENCE_NOT_FOUND',
      message: `Referenced artifact/doc path not found on disk: ${missingArtifactRefs.join(', ')}`,
      remediation: 'Correct file path(s) in completionDetails or generate the missing artifact(s).',
      refs: missingArtifactRefs
    });
  }

  return {
    taskId: task.id,
    taskName: task.name,
    status: task.status,
    completedAt: task.completedAt || null,
    evidenceRefs,
    githubEvidenceUrls,
    screenshotRefs,
    correctionOccurred,
    issues,
    pass: issues.length === 0
  };
}

function summarize(results) {
  const counts = {
    doneTasksChecked: results.length,
    passed: results.filter((r) => r.pass).length,
    failed: results.filter((r) => !r.pass).length,
    errors: 0,
    warnings: 0
  };

  for (const r of results) {
    for (const issue of r.issues) {
      if (issue.severity === 'error') counts.errors += 1;
      else counts.warnings += 1;
    }
  }

  return counts;
}

function applyRollback(board, failedResults) {
  const failedTaskIds = new Set(failedResults.map((r) => r.taskId));
  const done = Array.isArray(board?.columns?.done) ? board.columns.done : [];
  const inProgress = Array.isArray(board?.columns?.inProgress) ? board.columns.inProgress : [];
  const activityLog = Array.isArray(board?.activityLog) ? board.activityLog : [];

  const keptDone = [];
  const rolledBack = [];
  for (const task of done) {
    if (!failedTaskIds.has(task.id)) {
      keptDone.push(task);
      continue;
    }

    const result = failedResults.find((r) => r.taskId === task.id);
    task.status = 'inProgress';
    task.completedAt = null;
    task.updatedAt = new Date().toISOString();
    inProgress.unshift(task);
    activityLog.unshift({
      at: new Date().toISOString(),
      type: 'qa_gate_rollback',
      taskId: task.id,
      taskName: task.name,
      from: 'done',
      to: 'inProgress',
      detail: `Auto-rollback: ${result.issues.map((i) => i.code).join(', ')}`
    });
    rolledBack.push(task.id);
  }

  board.columns.done = keptDone;
  board.columns.inProgress = inProgress;
  board.activityLog = activityLog.slice(0, 500);
  return rolledBack;
}

function toMarkdown(report) {
  const lines = [];
  lines.push('# QA Evidence Integrity Report');
  lines.push('');
  lines.push(`Generated: ${report.generatedAt}`);
  lines.push(`Kanban: ${report.kanbanPath}`);
  lines.push(`Artifacts dir: ${report.artifactsDir}`);
  lines.push('');
  lines.push('## Summary');
  lines.push('');
  lines.push(`- Done tasks checked: **${report.summary.doneTasksChecked}**`);
  lines.push(`- Passed: **${report.summary.passed}**`);
  lines.push(`- Failed: **${report.summary.failed}**`);
  lines.push(`- Errors: **${report.summary.errors}**`);
  lines.push(`- Warnings: **${report.summary.warnings}**`);
  lines.push(`- Rolled back: **${report.rolledBackTaskIds.length}**`);
  lines.push('');
  lines.push('## Findings');
  lines.push('');

  if (report.results.length === 0) lines.push('_No done tasks found._');

  for (const result of report.results) {
    lines.push(`### ${result.pass ? '✅' : '❌'} ${result.taskName}`);
    lines.push('- Task ID: `' + result.taskId + '`');
    lines.push('- Correction occurred: ' + (result.correctionOccurred ? 'yes' : 'no'));
    lines.push('- Evidence refs: ' + (result.evidenceRefs.length ? result.evidenceRefs.map((v) => '`' + v + '`').join(', ') : '_(none)_'));
    if (result.issues.length === 0) lines.push('- Issues: none');
    else {
      lines.push('- Issues:');
      for (const issue of result.issues) lines.push(`  - [${issue.severity.toUpperCase()}] **${issue.code}** — ${issue.message}`);
    }
    lines.push('');
  }

  return lines.join('\n');
}

function main() {
  const args = parseArgs(process.argv);
  const board = safeReadJson(args.kanban);
  const doneTasks = Array.isArray(board?.columns?.done) ? board.columns.done : [];

  const context = { kanbanDir: path.dirname(args.kanban), artifactsDir: args.artifactsDir };
  const results = doneTasks.map((task) => checkTask(task, context));
  const summary = summarize(results);

  let rolledBackTaskIds = [];
  if (args.applyRollback) {
    const failedResults = results.filter((r) => !r.pass);
    rolledBackTaskIds = applyRollback(board, failedResults);
    fs.writeFileSync(args.kanban, JSON.stringify(board, null, 2), 'utf8');
  }

  const report = {
    generatedAt: new Date().toISOString(),
    kanbanPath: args.kanban,
    artifactsDir: args.artifactsDir,
    thresholds: {
      maxErrors: Number.isFinite(args.maxErrors) ? args.maxErrors : null,
      maxWarnings: Number.isFinite(args.maxWarnings) ? args.maxWarnings : null,
      failOnIssues: args.failOnIssues
    },
    summary,
    results,
    rolledBackTaskIds,
    applyRollback: args.applyRollback
  };

  const markdown = toMarkdown(report);
  if (args.jsonOut) {
    fs.mkdirSync(path.dirname(args.jsonOut), { recursive: true });
    fs.writeFileSync(args.jsonOut, JSON.stringify(report, null, 2), 'utf8');
  }
  if (args.mdOut) {
    fs.mkdirSync(path.dirname(args.mdOut), { recursive: true });
    fs.writeFileSync(args.mdOut, markdown, 'utf8');
  }

  if (!args.jsonOut) process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  if (!args.mdOut) process.stdout.write(`\n${markdown}\n`);

  const thresholdExceeded = summary.errors > args.maxErrors || summary.warnings > args.maxWarnings;
  if ((args.failOnIssues && summary.failed > 0) || thresholdExceeded) process.exitCode = 1;
}

module.exports = {
  parseArgs,
  extractEvidenceLinks,
  checkTask,
  summarize,
  toMarkdown,
  applyRollback,
  main
};

if (require.main === module) {
  try {
    main();
  } catch (err) {
    console.error(`qa-evidence-integrity-checker failed: ${err.message}`);
    process.exit(1);
  }
}
