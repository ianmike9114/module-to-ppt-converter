// PKCE (S256) helpers for Canva Connect OAuth. Canva requires a fresh
// verifier/challenge per authorization request.
const crypto = require('crypto');

function createPkcePair() {
  const verifier = crypto.randomBytes(64).toString('base64url'); // 86 chars
  const challenge = crypto.createHash('sha256').update(verifier).digest('base64url');
  return { verifier, challenge };
}

function createState() {
  return crypto.randomBytes(32).toString('base64url');
}

module.exports = { createPkcePair, createState };
