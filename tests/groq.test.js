const test = require('node:test');
const assert = require('node:assert');
const { MODEL_FALLBACK_CHAIN, maxTokensForModel, FREE_TIER_TPM } = require('../lib/config');
const { SYSTEM_INSTRUCTION, buildPrompt, isRetryableError, MAX_EXISTING_CONTENT_CHARS } = require('../lib/groq');

const params = { subject: 'UCSP', gradeLevel: '11', topic: 'Test', totalDays: 5, hoursPerDay: 1 };

test('fallback chain has no Groq-decommissioned models (EOL 2026-08-16)', () => {
  assert.deepStrictEqual(MODEL_FALLBACK_CHAIN, ['openai/gpt-oss-120b', 'openai/gpt-oss-20b']);
});

test('existingContent is capped so the request fits the free-tier TPM', () => {
  const prompt = buildPrompt({ ...params, existingContent: 'x'.repeat(100000) });
  assert.ok(prompt.length < MAX_EXISTING_CONTENT_CHARS + 1000);
  assert.match(prompt, /truncated/i);
});

test('worst-case prompt + max_tokens stays under the TPM cap for every model', () => {
  const prompt = buildPrompt({ ...params, existingContent: 'word '.repeat(50000) });
  const promptTokens = Math.ceil((SYSTEM_INSTRUCTION.length + prompt.length) / 3.5); // conservative chars/token
  for (const model of MODEL_FALLBACK_CHAIN) {
    assert.ok(promptTokens + maxTokensForModel(model) < FREE_TIER_TPM, `${model}: ${promptTokens} + ${maxTokensForModel(model)}`);
  }
});

test('only rate-limit and server errors are retried on the same model', () => {
  assert.strictEqual(isRetryableError({ status: 429 }), true);
  assert.strictEqual(isRetryableError({ status: 503 }), true);
  assert.strictEqual(isRetryableError({ status: 404 }), false);
  assert.strictEqual(isRetryableError({ status: 413 }), false);
  assert.strictEqual(isRetryableError({ status: 400 }), false);
  assert.strictEqual(isRetryableError(new Error('AI response failed validation')), true);
});
