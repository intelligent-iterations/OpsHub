#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const { validateHumanFacingUpdate, findGitHubUrls } = require('../lib/human-deliverable-guard');

function listTemplates(dirPath) {
  if (!fs.existsSync(dirPath)) return [];
  return fs
    .readdirSync(dirPath)
    .filter((name) => name.endsWith('.md'))
    .map((name) => path.join(dirPath, name));
}

function lintTemplate(content, filePath) {
  const issues = [];
  const gate = validateHumanFacingUpdate({ text: content, requireGitHubEvidence: false });
  if (!/##\s+evidence/i.test(content)) {
    issues.push({ code: 'MISSING_EVIDENCE_SECTION', message: 'Template must include an Evidence section.' });
  }

  if (findGitHubUrls(content).length === 0 && !/https:\/\/github\.com\/\.\.\./.test(content)) {
    issues.push({
      code: 'MISSING_GITHUB_PLACEHOLDER',
      message: 'Template must include at least one GitHub URL or https://github.com/... placeholder.'
    });
  }

  gate.issues.forEach((issue) => {
    issues.push({ code: issue.code, message: issue.message, refs: issue.refs || [] });
  });

  return {
    filePath,
    pass: issues.length === 0,
    issues
  };
}

function main() {
  const templatesDir = path.resolve(__dirname, 'templates');
  const templatePaths = listTemplates(templatesDir);
  const results = templatePaths.map((templatePath) => {
    const content = fs.readFileSync(templatePath, 'utf8');
    return lintTemplate(content, templatePath);
  });

  const failed = results.filter((result) => !result.pass);
  const payload = {
    generatedAt: new Date().toISOString(),
    templatesChecked: results.length,
    failed: failed.length,
    results
  };

  process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);

  if (failed.length > 0) {
    process.exitCode = 1;
  }
}

module.exports = {
  lintTemplate,
  listTemplates
};

if (require.main === module) {
  main();
}
