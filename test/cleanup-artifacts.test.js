const test = require('node:test');
const assert = require('node:assert/strict');

const cleanup = require('../scripts/cleanup-artifacts');

test('isCleanupCandidate matches old diagnostic artifact names', () => {
  const fs = require('fs');
  const os = require('os');
  const path = require('path');

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cleanup-artifacts-'));
  const file = path.join(dir, 'qa-evidence-report.json');
  fs.writeFileSync(file, '{}');

  const old = Date.now() - (10 * 24 * 60 * 60 * 1000);
  fs.utimesSync(file, new Date(old), new Date(old));

  const matched = cleanup.isCleanupCandidate(file, Date.now() - (7 * 24 * 60 * 60 * 1000));
  assert.equal(matched, true);

  fs.rmSync(dir, { recursive: true, force: true });
});

test('parseArgs supports apply and age settings', () => {
  const args = cleanup.parseArgs(['node', 'x', '--older-than-days', '14', '--apply']);
  assert.equal(args.olderThanDays, 14);
  assert.equal(args.apply, true);
});
