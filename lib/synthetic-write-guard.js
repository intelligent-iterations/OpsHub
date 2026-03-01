function normalizeMode(mode) {
  return String(mode || '').toLowerCase() === 'diagnostic' ? 'diagnostic' : 'production';
}

function normalizeText(value = '') {
  return String(value || '').toLowerCase().replace(/\s+/g, ' ').trim();
}

const SYNTHETIC_SIGNATURE_PATTERNS = [
  /\bsmoke task\b/,
  /\blifecycle task\b/,
  /\bintegration dashboard task\b/,
  /\bcloseout reminder\b/,
  /\bplaceholder\b/,
  /\bmanager-gap simulation(?: card)?\b/
];

function isDeniedSyntheticPattern(name = '', description = '') {
  const haystack = `${normalizeText(name)} ${normalizeText(description)}`;
  return SYNTHETIC_SIGNATURE_PATTERNS.some((pattern) => pattern.test(haystack));
}

function buildGuardBlockEvent({ mode, name, description, operation = 'kanban_write', path = 'unknown', source = null, taskId = null }) {
  return {
    event: 'synthetic_write_guard_blocked',
    mode: normalizeMode(mode),
    operation,
    path,
    source,
    taskId,
    name: String(name || '').slice(0, 200),
    descriptionPreview: String(description || '').slice(0, 160),
    timestamp: new Date().toISOString(),
  };
}

function evaluateSyntheticWriteGuard({ mode, name, description, operation, path, source = null, taskId = null, logger = console }) {
  const normalizedMode = normalizeMode(mode);
  if (normalizedMode !== 'production') return { ok: true, mode: normalizedMode };
  if (!isDeniedSyntheticPattern(name, description)) return { ok: true, mode: normalizedMode };

  const event = buildGuardBlockEvent({ mode: normalizedMode, name, description, operation, path, source, taskId });
  if (logger && typeof logger.warn === 'function') logger.warn(event);

  return {
    ok: false,
    mode: normalizedMode,
    status: 422,
    code: 'TASK_ADMISSION_SYNTHETIC_DENIED',
    error: 'task admission denied in production mode for synthetic/placeholder pattern',
    event,
  };
}

module.exports = {
  SYNTHETIC_SIGNATURE_PATTERNS,
  normalizeMode,
  isDeniedSyntheticPattern,
  evaluateSyntheticWriteGuard,
  buildGuardBlockEvent,
};
