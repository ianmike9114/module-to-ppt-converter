// Minimal Canva Connect REST client: OAuth (PKCE) + design import.
// fetchImpl is injectable so tests never hit the network.
const AUTHORIZE_URL = 'https://www.canva.com/api/oauth/authorize';
const API_BASE = 'https://api.canva.com/rest/v1';
const SCOPES = 'design:content:write';
const PPTX_MIME = 'application/vnd.openxmlformats-officedocument.presentationml.presentation';
const REFRESH_MARGIN_MS = 60 * 1000;

class CanvaApiError extends Error {
  constructor(message, status) {
    super(message);
    this.status = status;
  }
}

function getCanvaConfig(env = process.env) {
  const { CANVA_CLIENT_ID, CANVA_CLIENT_SECRET, CANVA_REDIRECT_URI, CANVA_SESSION_SECRET } = env;
  if (!CANVA_CLIENT_ID || !CANVA_CLIENT_SECRET || !CANVA_REDIRECT_URI || !CANVA_SESSION_SECRET) return null;
  return { clientId: CANVA_CLIENT_ID, clientSecret: CANVA_CLIENT_SECRET, redirectUri: CANVA_REDIRECT_URI, sessionSecret: CANVA_SESSION_SECRET };
}

function buildAuthorizeUrl(config, { challenge, state }) {
  const params = new URLSearchParams({
    code_challenge: challenge,
    code_challenge_method: 's256',
    scope: SCOPES,
    response_type: 'code',
    client_id: config.clientId,
    state,
    redirect_uri: config.redirectUri,
  });
  return `${AUTHORIZE_URL}?${params}`;
}

async function readJson(res) {
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new CanvaApiError(json.error_description || json.message || `Canva request failed (${res.status}).`, res.status);
  }
  return json;
}

async function tokenRequest(config, params, fetchImpl = fetch) {
  const res = await fetchImpl(`${API_BASE}/oauth/token`, {
    method: 'POST',
    headers: {
      Authorization: 'Basic ' + Buffer.from(`${config.clientId}:${config.clientSecret}`).toString('base64'),
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams(params).toString(),
  });
  const json = await readJson(res);
  return {
    accessToken: json.access_token,
    refreshToken: json.refresh_token,
    expiresAt: Date.now() + (json.expires_in || 0) * 1000,
  };
}

function exchangeCode(config, { code, verifier }, fetchImpl) {
  return tokenRequest(config, {
    grant_type: 'authorization_code',
    code,
    code_verifier: verifier,
    redirect_uri: config.redirectUri,
  }, fetchImpl);
}

function refreshTokens(config, refreshToken, fetchImpl) {
  return tokenRequest(config, { grant_type: 'refresh_token', refresh_token: refreshToken }, fetchImpl);
}

// Canva refresh tokens are single-use: callers MUST persist the returned
// tokens whenever refreshed is true.
async function ensureFreshTokens(config, tokens, fetchImpl) {
  if (tokens.expiresAt - REFRESH_MARGIN_MS > Date.now()) return { tokens, refreshed: false };
  return { tokens: await refreshTokens(config, tokens.refreshToken, fetchImpl), refreshed: true };
}

function normalizeJob(job) {
  return {
    id: job.id,
    status: job.status,
    editUrl: job.result?.designs?.[0]?.urls?.edit_url || null,
    error: job.error?.message || null,
  };
}

async function createImportJob(accessToken, { title, bytes }, fetchImpl = fetch) {
  const safeTitle = (title || '').trim().slice(0, 50) || 'Lesson deck';
  const metadata = { title_base64: Buffer.from(safeTitle, 'utf8').toString('base64'), mime_type: PPTX_MIME };
  const res = await fetchImpl(`${API_BASE}/imports`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/octet-stream',
      'Import-Metadata': JSON.stringify(metadata),
    },
    body: bytes,
  });
  return normalizeJob((await readJson(res)).job);
}

async function getImportJob(accessToken, jobId, fetchImpl = fetch) {
  const res = await fetchImpl(`${API_BASE}/imports/${encodeURIComponent(jobId)}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  return normalizeJob((await readJson(res)).job);
}

module.exports = {
  CanvaApiError,
  getCanvaConfig,
  buildAuthorizeUrl,
  exchangeCode,
  refreshTokens,
  ensureFreshTokens,
  createImportJob,
  getImportJob,
};
