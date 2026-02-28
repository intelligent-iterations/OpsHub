const fs = require('fs/promises');
const path = require('path');

const ALLOWED_ESCALATION_CATEGORIES = ['permissions', 'sudo', 'auth', 'secrets', 'access'];

function cleanText(value, maxLen = 2000) {
  const str = String(value ?? '')
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .trim();
  return str.length > maxLen ? str.slice(0, maxLen) : str;
}

function normalizeAttempt(attempt = {}) {
  return {
    agent: cleanText(attempt.agent || attempt.worker || '', 120).toLowerCase(),
    input: cleanText(attempt.input || attempt.prompt || '', 2000),
    output: cleanText(attempt.output || attempt.result || '', 4000),
    outcome: cleanText(attempt.outcome || attempt.status || '', 120).toLowerCase(),
    timestamp: cleanText(attempt.timestamp || attempt.at || '', 120)
  };
}

function isClaudeCodeAgent(value = '') {
  const v = cleanText(value, 120).toLowerCase();
  return v === 'claude code' || v === 'claude-code' || v === 'claudecode';
}

function classifyEscalationCategory(escalation = {}) {
  const direct = cleanText(escalation.category, 120).toLowerCase();
  if (ALLOWED_ESCALATION_CATEGORIES.includes(direct)) return direct;

  const haystack = `${escalation.reason || ''} ${escalation.detail || ''}`.toLowerCase();
  if (haystack.includes('permission')) return 'permissions';
  if (haystack.includes('sudo')) return 'sudo';
  if (haystack.includes('auth')) return 'auth';
  if (haystack.includes('secret')) return 'secrets';
  if (haystack.includes('access')) return 'access';
  return direct || null;
}

function evaluateBlockerProtocol(payload = {}) {
  const blocker = payload.blockerProtocol || payload.blocker || {};
  const blockerDetected = Boolean(
    blocker.detected ||
      payload.blockerDetected ||
      blocker.reason ||
      blocker.summary ||
      blocker.escalation?.requested
  );

  const attempts = Array.isArray(blocker.attempts) ? blocker.attempts.map(normalizeAttempt) : [];
  const escalation = blocker.escalation || {};
  const escalationRequested = Boolean(escalation.requested);
  const escalationCategory = classifyEscalationCategory(escalation);

  const issues = [];

  if (blockerDetected && !blocker.autoSpawned) {
    // caller should auto-populate, but this allows explicit linting
    issues.push('blocker-handler must be auto-spawned when blocker is detected');
  }

  if (escalationRequested) {
    if (!ALLOWED_ESCALATION_CATEGORIES.includes(escalationCategory || '')) {
      issues.push('escalation category must be one of: permissions/sudo/auth/secrets/access');
    }

    if (attempts.length !== 2) {
      issues.push('escalation requires exactly 2 Claude Code attempts');
    }

    attempts.forEach((attempt, idx) => {
      if (!isClaudeCodeAgent(attempt.agent)) {
        issues.push(`attempt ${idx + 1} must be executed by Claude Code`);
      }
      if (!attempt.input || !attempt.output || !attempt.outcome || !attempt.timestamp) {
        issues.push(`attempt ${idx + 1} must include input/output/outcome/timestamp proof`);
      }
    });
  }

  return {
    blockerDetected,
    escalationRequested,
    escalationCategory,
    attempts,
    issues,
    compliant: issues.length === 0,
    allowEscalation: escalationRequested && issues.length === 0
  };
}

async function captureBlockerProofArtifact({ artifactDir, taskId, from, to, protocolEval, payload }) {
  if (!protocolEval?.blockerDetected) return null;

  await fs.mkdir(artifactDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const fileName = `${taskId || 'unknown-task'}-${stamp}.json`;
  const artifactPath = path.join(artifactDir, fileName);

  const artifact = {
    capturedAt: new Date().toISOString(),
    taskId,
    transition: { from, to },
    blockerProtocol: {
      blockerDetected: protocolEval.blockerDetected,
      escalationRequested: protocolEval.escalationRequested,
      escalationCategory: protocolEval.escalationCategory,
      allowEscalation: protocolEval.allowEscalation,
      compliant: protocolEval.compliant,
      issues: protocolEval.issues,
      attempts: protocolEval.attempts
    },
    payloadSnapshot: payload || null
  };

  await fs.writeFile(artifactPath, JSON.stringify(artifact, null, 2), 'utf8');
  return artifactPath;
}

module.exports = {
  ALLOWED_ESCALATION_CATEGORIES,
  evaluateBlockerProtocol,
  captureBlockerProofArtifact
};
