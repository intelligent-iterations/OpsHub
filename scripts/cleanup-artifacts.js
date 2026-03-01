#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const DEFAULT_PATTERNS = [
  /inprogress-stale-report/i,
  /qa-evidence/i,
  /synthetic/i,
  /diagnostic/i,
  /tmp/i
];

function parseArgs(argv = process.argv) {
  const args = {
    artifactsDir: path.resolve(__dirname, '..', 'artifacts'),
    olderThanDays: 7,
    apply: false
  };

  for (let i = 2; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === '--artifacts-dir') args.artifactsDir = path.resolve(argv[++i]);
    else if (token === '--older-than-days') args.olderThanDays = Number(argv[++i]);
    else if (token === '--apply') args.apply = true;
    else if (token === '-h' || token === '--help') {
      console.log('Usage: node scripts/cleanup-artifacts.js [--artifacts-dir <path>] [--older-than-days <n>] [--apply]');
      process.exit(0);
    } else {
      throw new Error(`Unknown arg: ${token}`);
    }
  }
  return args;
}

function walk(dir, acc = []) {
  if (!fs.existsSync(dir)) return acc;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, acc);
    else acc.push(full);
  }
  return acc;
}

function isCleanupCandidate(filePath, cutoffMs) {
  const base = path.basename(filePath);
  if (!DEFAULT_PATTERNS.some((rx) => rx.test(base))) return false;
  const stat = fs.statSync(filePath);
  return stat.mtimeMs < cutoffMs;
}

function main() {
  const args = parseArgs(process.argv);
  const cutoffMs = Date.now() - (Math.max(0, args.olderThanDays) * 24 * 60 * 60 * 1000);
  const files = walk(args.artifactsDir);
  const candidates = files.filter((f) => isCleanupCandidate(f, cutoffMs));

  if (args.apply) {
    for (const file of candidates) fs.rmSync(file, { force: true });
  }

  process.stdout.write(`${JSON.stringify({ apply: args.apply, artifactsDir: args.artifactsDir, olderThanDays: args.olderThanDays, removed: candidates.length, files: candidates }, null, 2)}\n`);
}

module.exports = { parseArgs, isCleanupCandidate };

if (require.main === module) {
  try { main(); } catch (err) { console.error(`cleanup-artifacts failed: ${err.message}`); process.exit(1); }
}
