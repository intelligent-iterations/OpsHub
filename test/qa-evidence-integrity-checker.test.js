const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('node:child_process');

const checkerPath = path.resolve(__dirname, '..', 'scripts', 'qa-evidence-integrity-checker.js');
const checker = require('../scripts/qa-evidence-integrity-checker');

function makeTempWorkspace() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'qa-evidence-checker-'));
}

function writeKanban(dir, doneTasks) {
  const kanbanPath = path.join(dir, 'kanban.json');
  fs.writeFileSync(
    kanbanPath,
    JSON.stringify({ columns: { todo: [], inProgress: [], done: doneTasks } }, null, 2),
    'utf8'
  );
  return kanbanPath;
}

function runChecker(args) {
  return spawnSync(process.execPath, [checkerPath, ...args], {
    encoding: 'utf8'
  });
}

test('parseArgs reads new threshold and top-failures flags', () => {
  const args = checker.parseArgs([
    'node',
    checkerPath,
    '--max-errors',
    '2',
    '--max-warnings',
    '3',
    '--top-failures',
    '1'
  ]);

  assert.equal(args.maxErrors, 2);
  assert.equal(args.maxWarnings, 3);
  assert.equal(args.topFailures, 1);
  assert.equal(args.requireGithubLinksOnly, true);
  assert.equal(args.requireCorrectionLog, true);
});

test('parseArgs rejects negative threshold values', () => {
  assert.throws(
    () => checker.parseArgs(['node', checkerPath, '--max-errors', '-1']),
    /non-negative integer/
  );
});

test('parseArgs can disable github-only and correction-log checks', () => {
  const args = checker.parseArgs([
    'node',
    checkerPath,
    '--allow-non-github-links',
    '--no-correction-log-required'
  ]);

  assert.equal(args.requireGithubLinksOnly, false);
  assert.equal(args.requireCorrectionLog, false);
});

test('exits non-zero when error threshold is exceeded', () => {
  const tempDir = makeTempWorkspace();
  try {
    const kanbanPath = writeKanban(tempDir, [
      {
        id: 'task-1',
        name: 'Task missing evidence',
        status: 'done',
        description: 'Completed with no links.'
      }
    ]);

    const result = runChecker(['--kanban', kanbanPath, '--artifacts-dir', tempDir, '--max-errors', '0']);
    assert.equal(result.status, 1);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test('exits non-zero when warning threshold is exceeded', () => {
  const tempDir = makeTempWorkspace();
  try {
    const evidencePath = path.join(tempDir, 'evidence.md');
    fs.writeFileSync(evidencePath, '# evidence\n', 'utf8');

    const kanbanPath = writeKanban(tempDir, [
      {
        id: 'task-2',
        name: 'Task with evidence but no screenshot',
        status: 'done',
        description: `Evidence: ${evidencePath}`
      }
    ]);

    const result = runChecker(['--kanban', kanbanPath, '--artifacts-dir', tempDir, '--max-warnings', '0']);
    assert.equal(result.status, 1);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test('checkTask enforces github-only evidence refs and correction log compliance by default', () => {
  const result = checker.checkTask({
    id: 'task-3',
    name: 'Local path evidence task',
    status: 'done',
    description: 'Evidence: artifacts/local-proof.md\nScreenshot: artifacts/proof.png'
  }, {
    kanbanDir: '/tmp',
    artifactsDir: '/tmp/artifacts',
    requireGithubLinksOnly: true,
    requireCorrectionLog: true
  });

  const codes = result.issues.map((issue) => issue.code);
  assert.ok(codes.includes('NON_GITHUB_EVIDENCE_REFERENCE'));
  assert.ok(codes.includes('MISSING_CORRECTION_LOG'));
});

test('toMarkdown includes top remediation summary and applies slicing', () => {
  const report = {
    generatedAt: '2026-02-27T00:00:00.000Z',
    kanbanPath: '/tmp/kanban.json',
    artifactsDir: '/tmp/artifacts',
    topFailures: 1,
    summary: {
      doneTasksChecked: 2,
      passed: 0,
      failed: 2,
      errors: 2,
      warnings: 0
    },
    results: [
      {
        taskId: 't1',
        taskName: 'First failing task',
        pass: false,
        evidenceRefs: [],
        issues: [
          {
            severity: 'error',
            code: 'MISSING_EVIDENCE_LINK',
            message: 'missing',
            remediation: 'Add evidence links'
          }
        ]
      },
      {
        taskId: 't2',
        taskName: 'Second failing task',
        pass: false,
        evidenceRefs: [],
        issues: [
          {
            severity: 'error',
            code: 'ARTIFACT_REFERENCE_NOT_FOUND',
            message: 'missing file',
            remediation: 'Fix missing file paths'
          }
        ]
      }
    ]
  };

  const markdown = checker.toMarkdown(report);
  assert.match(markdown, /## Top Remediation Summary/);
  const [, remediationSection = ''] = markdown.split('## Top Remediation Summary');
  assert.match(remediationSection, /First failing task/);
  assert.doesNotMatch(remediationSection, /Second failing task/);
});
