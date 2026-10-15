const test = require('node:test');
const assert = require('node:assert');
const { seal, unseal } = require('../../lib/canva/seal');

const SECRET = 'x'.repeat(32);

test('round-trips an object', () => {
  const token = seal({ a: 1, b: 'two' }, SECRET);
  assert.deepStrictEqual(unseal(token, SECRET), { a: 1, b: 'two' });
});

test('returns null for tampered token or wrong secret', () => {
  const token = seal({ a: 1 }, SECRET);
  const [iv, tag, enc] = token.split('.');
  const flipped = enc[0] === 'A' ? 'B' + enc.slice(1) : 'A' + enc.slice(1);
  assert.strictEqual(unseal([iv, tag, flipped].join('.'), SECRET), null);
  assert.strictEqual(unseal(token, 'y'.repeat(32)), null);
  assert.strictEqual(unseal('garbage', SECRET), null);
});

test('rejects short secrets when sealing', () => {
  assert.throws(() => seal({}, 'short'), /at least 32/);
});
