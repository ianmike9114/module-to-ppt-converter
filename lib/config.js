// Groq free-tier model chain, ported from DepEd-AI-System/Apps/ModuleGenerator-Desktop/main/config.js.
// Order matters: each request's prompt + max_tokens must fit under the model's
// tokens-per-minute free-tier limit, so the model with the most headroom goes first.
const MODEL_FALLBACK_CHAIN = [
  'llama-3.3-70b-versatile',
  'openai/gpt-oss-120b',
  'llama-3.1-8b-instant',
];

const MAX_TOKENS_BY_MODEL = {
  'llama-3.3-70b-versatile': 8000,
  'openai/gpt-oss-120b': 4000,
  'llama-3.1-8b-instant': 2000,
};

function maxTokensForModel(model) {
  return MAX_TOKENS_BY_MODEL[model] || 4000;
}

const MAX_RETRIES = 3;
const RETRY_BASE_SECONDS = 5;

module.exports = { MODEL_FALLBACK_CHAIN, maxTokensForModel, MAX_RETRIES, RETRY_BASE_SECONDS };
