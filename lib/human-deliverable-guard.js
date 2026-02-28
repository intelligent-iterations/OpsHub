'use strict';

const GITHUB_URL_REGEX = /https:\/\/github\.com\/[^\s),]+/gi;
const ABS_LOCAL_PATH_REGEX = /(?:^|[\s(])(?:\/Users\/[^\s)]+|\/tmp\/[^\s)]+)/g;
const REL_LOCAL_PATH_REGEX = /(?:^|[\s(])(?:\.\.?\/[^\s)]+|(?:artifacts|docs|data|scripts|test|lib|tmp)\/[^\s),]+)/g;

function cleanRef(value) {
  return String(value || '').replace(/^[\s(]+|[\s),.;]+$/g, '');
}

function findGitHubUrls(text) {
  if (!text) return [];
  const matches = String(text).match(GITHUB_URL_REGEX) || [];
  return [...new Set(matches.map((item) => cleanRef(item)))];
}

function findLocalPathLeaks(text) {
  if (!text) return [];
  const raw = String(text);
  const refs = [];

  const collect = (regex) => {
    let match;
    while ((match = regex.exec(raw)) !== null) {
      refs.push(cleanRef(match[0]));
    }
  };

  collect(new RegExp(ABS_LOCAL_PATH_REGEX));
  collect(new RegExp(REL_LOCAL_PATH_REGEX));

  return [...new Set(refs.filter(Boolean))];
}

function validateHumanFacingUpdate({ text, requireGitHubEvidence = false } = {}) {
  const localPathLeaks = findLocalPathLeaks(text);
  const githubUrls = findGitHubUrls(text);
  const issues = [];

  if (localPathLeaks.length > 0) {
    issues.push({
      code: 'LOCAL_PATH_LEAK',
      message: 'Human-facing update contains local filesystem path(s).',
      refs: localPathLeaks
    });
  }

  if (requireGitHubEvidence && githubUrls.length === 0) {
    issues.push({
      code: 'MISSING_GITHUB_EVIDENCE',
      message: 'Done/completion update must include at least one https://github.com/... evidence URL.'
    });
  }

  return {
    pass: issues.length === 0,
    issues,
    githubUrls,
    localPathLeaks
  };
}

module.exports = {
  findGitHubUrls,
  findLocalPathLeaks,
  validateHumanFacingUpdate
};
