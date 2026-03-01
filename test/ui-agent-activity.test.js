const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs/promises');
const path = require('path');

test('UI includes agent activity panel and trace dialog drilldown wiring', async () => {
  const indexHtml = await fs.readFile(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');
  const appJs = await fs.readFile(path.join(__dirname, '..', 'public', 'app.js'), 'utf8');

  assert.match(indexHtml, /<h2>Agent Activity Monitor<\/h2>/);
  assert.match(indexHtml, /id="agentActivitySummary"/);
  assert.match(indexHtml, /id="agentTraceDialog"/);

  assert.match(appJs, /\/api\/agent-activity\/trace\//);
  assert.match(appJs, /data-agent-session-key/);
  assert.match(appJs, /openAgentTraceDialog/);
});
