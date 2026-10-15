// Encrypted httpOnly cookies for Canva tokens and the in-flight OAuth
// PKCE verifier/state. Route-handler only (uses next/headers).
const { cookies } = require('next/headers');
const { seal, unseal } = require('./seal');

const TOKENS_COOKIE = 'canva_session';
const OAUTH_COOKIE = 'canva_oauth';

function cookieOptions(maxAge) {
  return { httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'lax', path: '/', maxAge };
}

async function readCookie(name, config) {
  const value = (await cookies()).get(name)?.value;
  return value ? unseal(value, config.sessionSecret) : null;
}

async function readTokens(config) {
  return readCookie(TOKENS_COOKIE, config);
}

async function writeTokens(config, tokens) {
  (await cookies()).set(TOKENS_COOKIE, seal(tokens, config.sessionSecret), cookieOptions(60 * 60 * 24 * 30));
}

async function clearTokens() {
  (await cookies()).delete(TOKENS_COOKIE);
}

async function readOAuthState(config) {
  return readCookie(OAUTH_COOKIE, config);
}

async function writeOAuthState(config, value) {
  (await cookies()).set(OAUTH_COOKIE, seal(value, config.sessionSecret), cookieOptions(60 * 10));
}

async function clearOAuthState() {
  (await cookies()).delete(OAUTH_COOKIE);
}

module.exports = { readTokens, writeTokens, clearTokens, readOAuthState, writeOAuthState, clearOAuthState };
