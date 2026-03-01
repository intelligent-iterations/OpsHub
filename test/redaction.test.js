const test = require('node:test');
const assert = require('node:assert/strict');

const { redactString, redactValue } = require('../lib/redaction');

test('redactString masks common token formats', () => {
  const input = 'Bearer abc.def.ghi and ghp_abcdefghijklmnopqrstuvwxyz123456 and sk-1234567890abcdef1234';
  const output = redactString(input);

  assert.match(output, /Bearer \[REDACTED:TOKEN\]/);
  assert.doesNotMatch(output, /ghp_[A-Za-z0-9]+/);
  assert.doesNotMatch(output, /sk-[A-Za-z0-9]+/);
});

test('redactValue masks secret-ish keys and nested payloads', () => {
  const payload = {
    authorization: 'Bearer secret-token',
    params: {
      apiKey: 'abcdef123456',
      value: 'safe',
      nested: [{ token: 'xyz' }, 'password=supersecret']
    }
  };

  const output = redactValue(payload);
  assert.equal(output.authorization, '[REDACTED]');
  assert.equal(output.params.apiKey, '[REDACTED]');
  assert.equal(output.params.value, 'safe');
  assert.equal(output.params.nested[0].token, '[REDACTED]');
  assert.match(output.params.nested[1], /password=\[REDACTED\]/i);
});
