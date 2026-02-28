const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const { validateHumanFacingUpdate } = require('../lib/human-deliverable-guard');

const fixturesDir = path.resolve(__dirname, 'fixtures', 'qdrift-02');

function fixture(name) {
  return fs.readFileSync(path.join(fixturesDir, name), 'utf8');
}

test('passes when completion text has GitHub evidence and no local paths', () => {
  const result = validateHumanFacingUpdate({ text: fixture('pass.md'), requireGitHubEvidence: true });
  assert.equal(result.pass, true);
  assert.equal(result.issues.length, 0);
});

test('fails when completion text leaks local absolute path', () => {
  const result = validateHumanFacingUpdate({ text: fixture('fail-local-path.md'), requireGitHubEvidence: true });
  assert.equal(result.pass, false);
  assert.ok(result.issues.some((issue) => issue.code === 'LOCAL_PATH_LEAK'));
});

test('fails when completion text has no GitHub evidence URL', () => {
  const result = validateHumanFacingUpdate({ text: fixture('fail-missing-github.md'), requireGitHubEvidence: true });
  assert.equal(result.pass, false);
  assert.ok(result.issues.some((issue) => issue.code === 'MISSING_GITHUB_EVIDENCE'));
});
