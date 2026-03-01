#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawnSync } = require('child_process');

const kanbanPath = path.resolve(__dirname, '..', 'data', 'kanban.json');

function hashFile(filePath) {
  const buf = fs.readFileSync(filePath);
  return crypto.createHash('sha256').update(buf).digest('hex');
}

function main() {
  const before = hashFile(kanbanPath);
  const result = spawnSync(process.execPath, ['--test'], {
    cwd: path.resolve(__dirname, '..'),
    stdio: 'inherit',
    encoding: 'utf8'
  });

  const after = hashFile(kanbanPath);
  if (before !== after) {
    console.error('CI guard failed: tests touched production kanban path data/kanban.json');
    process.exit(1);
  }

  if (result.status !== 0) process.exit(result.status || 1);
}

if (require.main === module) {
  main();
}
