#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

const schemaPath = process.argv[2] || path.join(__dirname, '..', 'data', 'p25_rescue_friction_telemetry_schema.json');

function fail(msg) {
  console.error(`❌ ${msg}`);
  process.exitCode = 1;
}

function ok(msg) {
  console.log(`✅ ${msg}`);
}

if (!fs.existsSync(schemaPath)) {
  fail(`Schema file not found: ${schemaPath}`);
  process.exit(process.exitCode || 1);
}

let schema;
try {
  schema = JSON.parse(fs.readFileSync(schemaPath, 'utf8'));
} catch (error) {
  fail(`Invalid JSON: ${error.message}`);
  process.exit(process.exitCode || 1);
}

const requiredTopLevel = ['version', 'journey', 'funnelStages', 'requiredGlobalProperties', 'events', 'kpis'];
for (const key of requiredTopLevel) {
  if (!(key in schema)) fail(`Missing top-level key: ${key}`);
}

const eventNames = new Set();
for (const event of schema.events || []) {
  if (!event.name || !event.stage || !event.type) {
    fail(`Event missing required fields (name/stage/type): ${JSON.stringify(event)}`);
    continue;
  }

  if (!/^rescue_[a-z0-9_]+$/.test(event.name)) {
    fail(`Event name must match /^rescue_[a-z0-9_]+$/: ${event.name}`);
  }

  if (eventNames.has(event.name)) {
    fail(`Duplicate event name: ${event.name}`);
  }
  eventNames.add(event.name);

  if (!Array.isArray(event.requiredProperties)) {
    fail(`Event ${event.name} missing requiredProperties array`);
  }
}

const stageIds = new Set((schema.funnelStages || []).map((s) => s.id));
for (const event of schema.events || []) {
  if (!stageIds.has(event.stage)) {
    fail(`Event ${event.name} references unknown stage '${event.stage}'`);
  }
}

for (const stage of schema.funnelStages || []) {
  if (!eventNames.has(stage.entryEvent)) fail(`Stage '${stage.id}' entryEvent not found: ${stage.entryEvent}`);
  if (!eventNames.has(stage.successEvent)) fail(`Stage '${stage.id}' successEvent not found: ${stage.successEvent}`);
  if (!eventNames.has(stage.abandonEvent)) fail(`Stage '${stage.id}' abandonEvent not found: ${stage.abandonEvent}`);
}

if (!Array.isArray(schema.requiredGlobalProperties) || schema.requiredGlobalProperties.length < 8) {
  fail('requiredGlobalProperties should contain a meaningful global contract (>=8 fields)');
}

if (!Array.isArray(schema.kpis) || schema.kpis.length < 8) {
  fail('Expected at least 8 KPI definitions');
}

if (!process.exitCode) {
  ok(`Telemetry schema lint passed: ${path.relative(process.cwd(), schemaPath)}`);
}

process.exit(process.exitCode || 0);
