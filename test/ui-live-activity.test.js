const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs/promises');
const path = require('path');

test('UI includes Live Agent Activity panel wiring', async () => {
  const indexHtml = await fs.readFile(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');
  const appJs = await fs.readFile(path.join(__dirname, '..', 'public', 'app.js'), 'utf8');

  assert.match(indexHtml, /<h2>Live Agent Activity<\/h2>/);
  assert.match(indexHtml, /id="liveAgentActivity"/);
  assert.match(appJs, /renderList\('liveAgentActivity'/);
  assert.match(appJs, /Current task\/session:/);
  assert.match(appJs, /Last update:/);
});
