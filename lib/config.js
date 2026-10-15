// Groq free-tier model chain, kept in sync with
// DepEd-AI-System/Apps/ModuleGenerator-Desktop/main/config.js.
//
// Groq DECOMMISSIONED llama-3.3-70b-versatile and llama-3.1-8b-instant on
// 2026-08-16 — every request to either 404s "model_not_found", which walked
// the old chain down and surfaced the 8B 404 to the teacher. Groq's migration
// guidance maps them to openai/gpt-oss-120b and openai/gpt-oss-20b. Preview
// models (qwen/*, etc.) are deliberately excluded: a preview id can be pulled
// at any time and reintroduce exactly this outage.
const MODEL_FALLBACK_CHAIN = [
  'openai/gpt-oss-120b',
  'openai/gpt-oss-20b',
];

// Both gpt-oss models cap at 8000 tokens-per-minute on the free tier, and
// Groq counts prompt + max_tokens against it per request (over = hard 413,
// not a retryable 429). lib/groq.js caps uploaded module text so the
// worst-case prompt plus this budget stays under the cap (see tests/groq.test.js).
const FREE_TIER_TPM = 8000;

const MAX_TOKENS_BY_MODEL = {
  'openai/gpt-oss-120b': 5000,
  'openai/gpt-oss-20b': 5000,
};

function maxTokensForModel(model) {
  return MAX_TOKENS_BY_MODEL[model] || 4000;
}

const MAX_RETRIES = 3;
const RETRY_BASE_SECONDS = 5;

module.exports = { MODEL_FALLBACK_CHAIN, FREE_TIER_TPM, maxTokensForModel, MAX_RETRIES, RETRY_BASE_SECONDS };
