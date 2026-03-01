#!/usr/bin/env node
'use strict';

const SENSITIVE_KEY_RX = /(token|secret|password|authorization|api[-_]?key|cookie|session[-_]?id|bearer)/i;

function nowIso() {
  return new Date().toISOString();
}

function safeJsonParse(raw) {
  try {
    return { ok: true, value: JSON.parse(raw) };
  } catch (error) {
    return { ok: false, error: error?.message || 'invalid_json' };
  }
}

function redactSensitive(value, keyPath = '') {
  if (value == null) return value;

  if (typeof value === 'string') {
    if (/bearer\s+[a-z0-9._-]+/i.test(value)) return '[REDACTED]';
    if (value.length > 2000) return `${value.slice(0, 2000)}...[TRUNCATED]`;
    return value;
  }

  if (typeof value === 'number' || typeof value === 'boolean') return value;

  if (Array.isArray(value)) {
    return value.map((item, index) => redactSensitive(item, `${keyPath}[${index}]`));
  }

  if (typeof value === 'object') {
    const out = {};
    for (const [key, v] of Object.entries(value)) {
      const nextPath = keyPath ? `${keyPath}.${key}` : key;
      if (SENSITIVE_KEY_RX.test(key) || SENSITIVE_KEY_RX.test(nextPath)) {
        out[key] = '[REDACTED]';
      } else {
        out[key] = redactSensitive(v, nextPath);
      }
    }
    return out;
  }

  return String(value);
}

function normalizeToolCall(entry = {}) {
  const toolName = entry.toolName || entry.tool || entry.name || null;
  if (!toolName) return null;

  return {
    name: String(toolName),
    inputs: redactSensitive(entry.inputs ?? entry.input ?? entry.args ?? null),
    outputs: redactSensitive(entry.outputs ?? entry.output ?? entry.result ?? null),
    error: entry.error ? redactSensitive(entry.error) : null,
    exit: Number.isFinite(Number(entry.exit)) ? Number(entry.exit) : null
  };
}

function normalizeRecord(input = {}, source = 'unknown') {
  const tool = normalizeToolCall(input.toolCall || input.tool || input);
  const startedAt = input.startedAt || input.startTime || input.ts || null;
  const updatedAt = input.updatedAt || input.endTime || input.ts || startedAt || nowIso();

  return {
    agent: input.agent || input.agentId || input.model || 'unknown',
    session: input.session || input.sessionKey || input.sessionId || 'unknown',
    active: Boolean(input.active ?? (input.status === 'active') ?? true),
    currentToolCall: tool ? tool.name : null,
    toolInputs: tool ? tool.inputs : null,
    toolOutputs: tool ? tool.outputs : null,
    error: tool?.error || input.error || null,
    exit: tool?.exit ?? (Number.isFinite(Number(input.exit)) ? Number(input.exit) : null),
    startedAt,
    updatedAt,
    source
  };
}

function parseGatewayLogLine(line) {
  if (!line || !line.trim()) {
    return { ok: false, reason: 'empty_line' };
  }

  const parsed = safeJsonParse(line);
  if (!parsed.ok) {
    return {
      ok: false,
      reason: 'invalid_json_line',
      raw: line.slice(0, 500)
    };
  }

  return {
    ok: true,
    record: normalizeRecord(parsed.value, 'gateway-log')
  };
}

function ingestGatewayTelemetry(options = {}) {
  const diagnostics = {
    errors: [],
    skippedLines: 0,
    parsedLines: 0,
    fallbackUsed: false
  };

  const records = [];

  const logsText = typeof options.logsText === 'string' ? options.logsText : '';
  if (logsText.trim()) {
    const lines = logsText.split(/\r?\n/);
    for (const line of lines) {
      if (!line.trim()) continue;
      const parsed = parseGatewayLogLine(line);
      if (!parsed.ok) {
        diagnostics.skippedLines += 1;
        diagnostics.errors.push(parsed.reason);
        continue;
      }
      diagnostics.parsedLines += 1;
      records.push(parsed.record);
    }
  }

  const traces = Array.isArray(options.sessionTraces) ? options.sessionTraces : [];
  for (const trace of traces) {
    records.push(normalizeRecord(trace, 'session-trace'));
  }

  if (records.length === 0 && Array.isArray(options.fallbackRecords) && options.fallbackRecords.length > 0) {
    diagnostics.fallbackUsed = true;
    for (const fallback of options.fallbackRecords) {
      records.push(normalizeRecord(fallback, 'fallback'));
    }
  }

  return {
    generatedAt: nowIso(),
    schemaVersion: 'telemetry.v1',
    records,
    diagnostics
  };
}

module.exports = {
  redactSensitive,
  normalizeToolCall,
  normalizeRecord,
  parseGatewayLogLine,
  ingestGatewayTelemetry
};
