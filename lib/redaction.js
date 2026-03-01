function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

const KEY_HINTS = /(token|secret|password|passwd|api[-_]?key|authorization|auth|bearer|cookie|session|private[-_]?key|x[-_]?api[-_]?key)/i;
const JWT_RX = /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9._-]{8,}\.[A-Za-z0-9._-]{8,}\b/g;
const GH_PAT_RX = /\bgh[pousr]_[A-Za-z0-9]{20,}\b/g;
const OPENAI_KEY_RX = /\bsk-[A-Za-z0-9]{16,}\b/g;
const GENERIC_ASSIGNMENT_RX = /(token|secret|password|api[_-]?key|authorization)\s*[:=]\s*(["'])?([^\s,'"}]{6,})\2?/gi;
const BEARER_RX = /\bBearer\s+[A-Za-z0-9._-]{8,}\b/gi;

function redactString(value) {
  let output = String(value ?? '');
  output = output.replace(JWT_RX, '[REDACTED:JWT]');
  output = output.replace(GH_PAT_RX, '[REDACTED:GITHUB_TOKEN]');
  output = output.replace(OPENAI_KEY_RX, '[REDACTED:API_KEY]');
  output = output.replace(BEARER_RX, 'Bearer [REDACTED:TOKEN]');
  output = output.replace(GENERIC_ASSIGNMENT_RX, (_m, key) => `${key}=[REDACTED]`);
  return output;
}

function redactValue(value, contextKey = '') {
  if (typeof value === 'string') {
    if (KEY_HINTS.test(contextKey)) return '[REDACTED]';
    return redactString(value);
  }

  if (typeof value === 'number' || typeof value === 'boolean' || value == null) return value;

  if (Array.isArray(value)) {
    return value.map((entry) => redactValue(entry, contextKey));
  }

  if (isObject(value)) {
    const out = {};
    for (const [key, inner] of Object.entries(value)) {
      if (KEY_HINTS.test(key)) {
        out[key] = '[REDACTED]';
      } else {
        out[key] = redactValue(inner, key);
      }
    }
    return out;
  }

  return redactString(String(value));
}

module.exports = {
  redactValue,
  redactString
};
