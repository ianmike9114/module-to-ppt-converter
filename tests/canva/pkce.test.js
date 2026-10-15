const test = require('node:test');
const assert = require('node:assert');
const crypto = require('crypto');
const { createPkcePair, createState } = require('../../lib/canva/pkce');

test('verifier is 43-128 url-safe chars and challenge is its S256 hash', () => {
  const { verifier, challenge } = createPkcePair();
  assert.match(verifier, /^[A-Za-z0-9\-._~]{43,128}$/);
  const expected = crypto.createHash('sha256').update(verifier).digest('base64url');
  assert.strictEqual(challenge, expected);
});

test('state values are unique', () => {
  assert.notStrictEqual(createState(), createState());
});
