const test = require('node:test');
const assert = require('node:assert/strict');

const { lintTemplate } = require('../scripts/report-template-lint');

test('report template linter passes compliant template', () => {
  const template = `# Completion\n\n## Evidence\n- Commit: https://github.com/.../commit/<sha>\n`;
  const result = lintTemplate(template, 'compliant.md');
  assert.equal(result.pass, true);
});

test('report template linter fails template with local path leak', () => {
  const template = `# Completion\n\n## Evidence\n- Artifact: /Users/claw/report.md\n`;
  const result = lintTemplate(template, 'bad.md');
  assert.equal(result.pass, false);
  assert.ok(result.issues.some((issue) => issue.code === 'LOCAL_PATH_LEAK'));
});
