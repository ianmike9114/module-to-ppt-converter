# "Open in Canva" Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

## Context

The app already turns a module or a topic into a 4–5 day `.pptx` (Groq text → Gemini images → `pptxgenjs`). The teacher wants to **finish/restyle the deck in Canva** without manually downloading and re-uploading. Decisions made during brainstorming:

- **Approach:** after a deck is generated, an **"Open in Canva"** button imports the same `.pptx` into the teacher's own Canva account via the **Canva Connect API Design Import** (`POST /v1/imports`), then shows the Canva edit link. Works on free Canva accounts. (Rejected: Canva Autofill — Enterprise-only; GitHub-only design tweaks — not what was asked.)
- **Rollout:** build it as a **Public** Canva integration that runs in draft. Draft only works for the developer's own Canva account, so co-teachers get it once Canva approves the integration. Until then (or when the Canva env vars are missing) the UI shows manual "upload to Canva" instructions instead.
- **No database:** Canva tokens live in an **AES-256-GCM encrypted, httpOnly cookie**. The PKCE verifier and the OAuth state go in a short-lived encrypted cookie. The client secret stays on the server.
- **No lost deck on sign-in:** the Canva sign-in runs in a **popup**, so the generated deck (held in React state as a Blob) survives.

**Goal:** Add a one-click "Open in Canva" step to the existing generator.

**Architecture:** New `lib/canva/*` CommonJS helpers (PKCE, cookie sealing, a Canva REST client with injectable `fetch`) and a browser helper. New `app/api/canva/*` route handlers: connect, callback, status, import, poll import, disconnect. `app/page.js` keeps the generated Blob and adds the button.

**Tech Stack:** Next.js 16 App Router, Node `crypto`, built-in `fetch`, `node:test` for unit tests (no new dependencies).

## Global Constraints

- No new npm dependencies. Unit tests use `node --test`.
- `lib/` files stay CommonJS (`require`/`module.exports`), matching `lib/groq.js` and `lib/schema.js`.
- Env vars (server only, never sent to the client): `CANVA_CLIENT_ID`, `CANVA_CLIENT_SECRET`, `CANVA_REDIRECT_URI`, `CANVA_SESSION_SECRET` (≥32 chars).
- OAuth scope: `design:content:write` (only). PKCE S256 is mandatory.
- Canva endpoints: authorize `https://www.canva.com/api/oauth/authorize`; token `POST https://api.canva.com/rest/v1/oauth/token` (Basic auth with `client_id:client_secret`, form-encoded); import `POST https://api.canva.com/rest/v1/imports`; poll `GET https://api.canva.com/rest/v1/imports/{jobId}`.
- Import title ≤ 50 chars, sent base64 in the `Import-Metadata` header JSON (`title_base64`, `mime_type`).
- Refresh tokens are **single-use**. Every refresh must rewrite the session cookie.
- The existing download flow must keep working unchanged when Canva isn't configured.
- Local dev must be browsed at `http://127.0.0.1:3000` (Canva redirect URL host must match the cookie host).

## File map

| File | Responsibility |
|---|---|
| `lib/canva/pkce.js` (new) | `createPkcePair()`, `createState()` |
| `lib/canva/seal.js` (new) | `seal(obj, secret)`, `unseal(token, secret)`: AES-256-GCM cookie values |
| `lib/canva/client.js` (new) | `getCanvaConfig`, `buildAuthorizeUrl`, `exchangeCode`, `refreshTokens`, `ensureFreshTokens`, `createImportJob`, `getImportJob` |
| `lib/canva/session.js` (new) | Next cookie read/write: `readTokens`, `writeTokens`, `clearTokens`, `readOAuthState`, `writeOAuthState`, `clearOAuthState` |
| `lib/canva/browser.js` (new) | Client-side `connectCanvaPopup()`, `importDeckToCanva()` |
| `app/api/canva/{connect,callback,status,disconnect}/route.js` (new) | OAuth + status |
| `app/api/canva/import/route.js`, `app/api/canva/import/[jobId]/route.js` (new) | Upload + poll |
| `app/page.js` (modify) | Keep Blob, show Canva panel |
| `tests/canva/*.test.js` (new) | Unit tests for pkce/seal/client |
| `package.json`, `vercel.json`, `.env.example` (new), `.claude/Skills/module-to-ppt-converter/SKILL.md` | Test script, durations, env docs, skill doc ("No Canva API is used" is now false) |

---

### Task 1: PKCE + cookie sealing helpers

**Files:** Create `lib/canva/pkce.js`, `lib/canva/seal.js`, `tests/canva/pkce.test.js`, `tests/canva/seal.test.js`. Modify `package.json` (add `"test": "node --test tests/"`).

**Produces:** `createPkcePair(): {verifier, challenge}`, `createState(): string`, `seal(obj, secret): string`, `unseal(token, secret): object|null`.

- [ ] **Step 1: Write failing tests**

```js
// tests/canva/pkce.test.js
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
```

```js
// tests/canva/seal.test.js
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
  assert.strictEqual(unseal(token.slice(0, -2) + 'AA', SECRET), null);
  assert.strictEqual(unseal(token, 'y'.repeat(32)), null);
  assert.strictEqual(unseal('garbage', SECRET), null);
});

test('rejects short secrets when sealing', () => {
  assert.throws(() => seal({}, 'short'), /at least 32/);
});
```

- [ ] **Step 2: Run `npm test`.** Expected: FAIL, `Cannot find module '../../lib/canva/pkce'`.

- [ ] **Step 3: Implement**

```js
// lib/canva/pkce.js
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
```

```js
// lib/canva/seal.js
// Encrypts small JSON payloads (Canva tokens, PKCE verifier) for httpOnly
// cookies, so the app needs no database on Vercel.
const crypto = require('crypto');

function keyFrom(secret) {
  if (!secret || secret.length < 32) {
    throw new Error('CANVA_SESSION_SECRET must be at least 32 characters.');
  }
  return crypto.createHash('sha256').update(secret).digest();
}

function seal(obj, secret) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', keyFrom(secret), iv);
  const encrypted = Buffer.concat([cipher.update(JSON.stringify(obj), 'utf8'), cipher.final()]);
  return [iv, cipher.getAuthTag(), encrypted].map((b) => b.toString('base64url')).join('.');
}

function unseal(token, secret) {
  try {
    const [iv, tag, encrypted] = token.split('.').map((s) => Buffer.from(s, 'base64url'));
    const decipher = crypto.createDecipheriv('aes-256-gcm', keyFrom(secret), iv);
    decipher.setAuthTag(tag);
    return JSON.parse(Buffer.concat([decipher.update(encrypted), decipher.final()]).toString('utf8'));
  } catch {
    return null;
  }
}

module.exports = { seal, unseal };
```

- [ ] **Step 4: Run `npm test`.** Expected: all 5 tests PASS.
- [ ] **Step 5: Commit** `git add lib/canva tests/canva package.json && git commit -m "feat(canva): add PKCE and cookie sealing helpers"`

---

### Task 2: Canva REST client

**Files:** Create `lib/canva/client.js`, `tests/canva/client.test.js`.

**Consumes:** nothing from Task 1 (pure HTTP).
**Produces:**
- `getCanvaConfig(env = process.env): {clientId, clientSecret, redirectUri, sessionSecret} | null`
- `buildAuthorizeUrl(config, {challenge, state}): string`
- `exchangeCode(config, {code, verifier}, fetchImpl?): Promise<Tokens>`
- `refreshTokens(config, refreshToken, fetchImpl?): Promise<Tokens>`
- `ensureFreshTokens(config, tokens, fetchImpl?): Promise<{tokens: Tokens, refreshed: boolean}>`
- `createImportJob(accessToken, {title, bytes}, fetchImpl?): Promise<Job>`
- `getImportJob(accessToken, jobId, fetchImpl?): Promise<Job>`
- `Tokens = {accessToken, refreshToken, expiresAt /* ms epoch */}`; `Job = {id, status: 'in_progress'|'success'|'failed', editUrl: string|null, error: string|null}`
- Errors thrown are `CanvaApiError` with `.status` (HTTP status).

- [ ] **Step 1: Write failing tests**

```js
// tests/canva/client.test.js
const test = require('node:test');
const assert = require('node:assert');
const c = require('../../lib/canva/client');

const config = { clientId: 'cid', clientSecret: 'csecret', redirectUri: 'http://127.0.0.1:3000/api/canva/callback', sessionSecret: 'x'.repeat(32) };

function fakeFetch(status, body, calls) {
  return async (url, init) => {
    calls.push({ url, init });
    return { ok: status >= 200 && status < 300, status, json: async () => body };
  };
}

test('getCanvaConfig returns null when any env var is missing', () => {
  assert.strictEqual(c.getCanvaConfig({ CANVA_CLIENT_ID: 'a' }), null);
  const full = { CANVA_CLIENT_ID: 'a', CANVA_CLIENT_SECRET: 'b', CANVA_REDIRECT_URI: 'c', CANVA_SESSION_SECRET: 'd' };
  assert.deepStrictEqual(c.getCanvaConfig(full), { clientId: 'a', clientSecret: 'b', redirectUri: 'c', sessionSecret: 'd' });
});

test('buildAuthorizeUrl includes PKCE, scope, state, redirect', () => {
  const url = new URL(c.buildAuthorizeUrl(config, { challenge: 'CH', state: 'ST' }));
  assert.strictEqual(url.origin + url.pathname, 'https://www.canva.com/api/oauth/authorize');
  assert.strictEqual(url.searchParams.get('code_challenge'), 'CH');
  assert.strictEqual(url.searchParams.get('code_challenge_method'), 's256');
  assert.strictEqual(url.searchParams.get('scope'), 'design:content:write');
  assert.strictEqual(url.searchParams.get('response_type'), 'code');
  assert.strictEqual(url.searchParams.get('client_id'), 'cid');
  assert.strictEqual(url.searchParams.get('state'), 'ST');
  assert.strictEqual(url.searchParams.get('redirect_uri'), config.redirectUri);
});

test('exchangeCode posts basic-auth form and maps tokens', async () => {
  const calls = [];
  const before = Date.now();
  const tokens = await c.exchangeCode(config, { code: 'CODE', verifier: 'VER' },
    fakeFetch(200, { access_token: 'AT', refresh_token: 'RT', expires_in: 3600 }, calls));
  assert.strictEqual(calls[0].url, 'https://api.canva.com/rest/v1/oauth/token');
  assert.strictEqual(calls[0].init.headers.Authorization, 'Basic ' + Buffer.from('cid:csecret').toString('base64'));
  const form = new URLSearchParams(calls[0].init.body);
  assert.strictEqual(form.get('grant_type'), 'authorization_code');
  assert.strictEqual(form.get('code'), 'CODE');
  assert.strictEqual(form.get('code_verifier'), 'VER');
  assert.strictEqual(tokens.accessToken, 'AT');
  assert.strictEqual(tokens.refreshToken, 'RT');
  assert.ok(tokens.expiresAt >= before + 3600 * 1000);
});

test('ensureFreshTokens refreshes only when near expiry', async () => {
  const calls = [];
  const fresh = { accessToken: 'A', refreshToken: 'R', expiresAt: Date.now() + 10 * 60 * 1000 };
  const r1 = await c.ensureFreshTokens(config, fresh, fakeFetch(200, {}, calls));
  assert.strictEqual(r1.refreshed, false);
  assert.strictEqual(calls.length, 0);

  const stale = { ...fresh, expiresAt: Date.now() + 1000 };
  const r2 = await c.ensureFreshTokens(config, stale, fakeFetch(200, { access_token: 'A2', refresh_token: 'R2', expires_in: 3600 }, calls));
  assert.strictEqual(r2.refreshed, true);
  assert.strictEqual(r2.tokens.refreshToken, 'R2');
  assert.strictEqual(new URLSearchParams(calls[0].init.body).get('grant_type'), 'refresh_token');
});

test('createImportJob sends octet-stream with base64 title metadata', async () => {
  const calls = [];
  const job = await c.createImportJob('AT', { title: 'Cell Biology', bytes: Buffer.from('pptx') },
    fakeFetch(200, { job: { id: 'J1', status: 'in_progress' } }, calls));
  const { headers } = calls[0].init;
  assert.strictEqual(calls[0].url, 'https://api.canva.com/rest/v1/imports');
  assert.strictEqual(headers.Authorization, 'Bearer AT');
  assert.strictEqual(headers['Content-Type'], 'application/octet-stream');
  const meta = JSON.parse(headers['Import-Metadata']);
  assert.strictEqual(Buffer.from(meta.title_base64, 'base64').toString(), 'Cell Biology');
  assert.strictEqual(meta.mime_type, 'application/vnd.openxmlformats-officedocument.presentationml.presentation');
  assert.deepStrictEqual(job, { id: 'J1', status: 'in_progress', editUrl: null, error: null });
});

test('createImportJob truncates title to 50 chars and defaults empty title', async () => {
  const calls = [];
  await c.createImportJob('AT', { title: 'x'.repeat(80), bytes: Buffer.from('') }, fakeFetch(200, { job: { id: 'J', status: 'in_progress' } }, calls));
  await c.createImportJob('AT', { title: '', bytes: Buffer.from('') }, fakeFetch(200, { job: { id: 'J', status: 'in_progress' } }, calls));
  const t = (i) => Buffer.from(JSON.parse(calls[i].init.headers['Import-Metadata']).title_base64, 'base64').toString();
  assert.strictEqual(t(0).length, 50);
  assert.strictEqual(t(1), 'Lesson deck');
});

test('getImportJob maps success edit url and failure message', async () => {
  const ok = await c.getImportJob('AT', 'J1', fakeFetch(200, { job: { id: 'J1', status: 'success', result: { designs: [{ urls: { edit_url: 'https://canva.com/e' } }] } } }, []));
  assert.strictEqual(ok.editUrl, 'https://canva.com/e');
  const bad = await c.getImportJob('AT', 'J1', fakeFetch(200, { job: { id: 'J1', status: 'failed', error: { code: 'invalid_file', message: 'Bad file' } } }, []));
  assert.strictEqual(bad.error, 'Bad file');
});

test('non-2xx responses throw CanvaApiError with status', async () => {
  await assert.rejects(
    c.getImportJob('AT', 'J1', fakeFetch(401, { message: 'Unauthorized' }, [])),
    (err) => err instanceof c.CanvaApiError && err.status === 401 && /Unauthorized/.test(err.message),
  );
});
```

- [ ] **Step 2: Run `npm test`.** Expected: FAIL, `Cannot find module '../../lib/canva/client'`.

- [ ] **Step 3: Implement**

```js
// lib/canva/client.js
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
```

- [ ] **Step 4: Run `npm test`.** Expected: all tests PASS.
- [ ] **Step 5: Commit** `git add lib/canva/client.js tests/canva/client.test.js && git commit -m "feat(canva): add Connect API client for OAuth and design import"`

---

### Task 3: Session cookies + OAuth routes (connect, callback, status, disconnect)

**Files:** Create `lib/canva/session.js`, `app/api/canva/connect/route.js`, `app/api/canva/callback/route.js`, `app/api/canva/status/route.js`, `app/api/canva/disconnect/route.js`, `.env.example`.

**Consumes:** `seal`/`unseal` (Task 1), `createPkcePair`/`createState` (Task 1), `getCanvaConfig`/`buildAuthorizeUrl`/`exchangeCode` (Task 2).
**Produces:** `readTokens(config): Promise<Tokens|null>`, `writeTokens(config, tokens): Promise<void>`, `clearTokens(): Promise<void>`, `writeOAuthState(config, {verifier, state})`, `readOAuthState(config): Promise<{verifier, state}|null>`, `clearOAuthState()`. Routes: `GET /api/canva/status → {enabled: boolean, connected: boolean}`. `GET /api/canva/connect` redirects to Canva. `GET /api/canva/callback` returns popup HTML that posts `{type: 'canva-auth', ok: boolean}` to `window.opener`. `POST /api/canva/disconnect → {ok: true}`.

- [ ] **Step 1: Implement `lib/canva/session.js`**

```js
// lib/canva/session.js
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
```

- [ ] **Step 2: Implement the routes**

```js
// app/api/canva/status/route.js
import { getCanvaConfig } from '@/lib/canva/client';
import { readTokens } from '@/lib/canva/session';

export async function GET() {
  const config = getCanvaConfig();
  if (!config) return Response.json({ enabled: false, connected: false });
  const tokens = await readTokens(config);
  return Response.json({ enabled: true, connected: Boolean(tokens?.refreshToken) });
}
```

```js
// app/api/canva/connect/route.js
import { getCanvaConfig, buildAuthorizeUrl } from '@/lib/canva/client';
import { createPkcePair, createState } from '@/lib/canva/pkce';
import { writeOAuthState } from '@/lib/canva/session';

export async function GET() {
  const config = getCanvaConfig();
  if (!config) return new Response('Canva is not configured on this server.', { status: 503 });

  const { verifier, challenge } = createPkcePair();
  const state = createState();
  await writeOAuthState(config, { verifier, state });
  return Response.redirect(buildAuthorizeUrl(config, { challenge, state }), 302);
}
```

```js
// app/api/canva/callback/route.js
import { getCanvaConfig, exchangeCode } from '@/lib/canva/client';
import { readOAuthState, clearOAuthState, writeTokens } from '@/lib/canva/session';

// Runs inside the sign-in popup opened by lib/canva/browser.js: tell the
// opener the result and close, so the generated deck in the main tab survives.
function popupResponse(ok, message) {
  const html = `<!doctype html><meta charset="utf-8"><title>Canva</title>
<p style="font-family:sans-serif">${message}</p>
<script>if (window.opener) { window.opener.postMessage({ type: 'canva-auth', ok: ${ok} }, location.origin); window.close(); }</script>`;
  return new Response(html, { status: ok ? 200 : 400, headers: { 'Content-Type': 'text/html; charset=utf-8' } });
}

export async function GET(request) {
  const config = getCanvaConfig();
  if (!config) return popupResponse(false, 'Canva is not configured on this server.');

  const params = new URL(request.url).searchParams;
  const saved = await readOAuthState(config);
  await clearOAuthState();

  if (params.get('error')) return popupResponse(false, 'Canva sign-in was cancelled or not allowed. You can close this window.');
  if (!saved || !params.get('state') || params.get('state') !== saved.state) {
    return popupResponse(false, 'Sign-in session expired. Close this window and try again.');
  }

  try {
    const tokens = await exchangeCode(config, { code: params.get('code'), verifier: saved.verifier });
    await writeTokens(config, tokens);
    return popupResponse(true, 'Connected to Canva. You can close this window.');
  } catch (error) {
    console.error('canva callback error:', error);
    return popupResponse(false, 'Could not finish connecting to Canva. Close this window and try again.');
  }
}
```

```js
// app/api/canva/disconnect/route.js
import { clearTokens } from '@/lib/canva/session';

export async function POST() {
  await clearTokens();
  return Response.json({ ok: true });
}
```

```
# .env.example (commit this; real values go in .env.local / Vercel env vars)
GROQ_API_KEY=
GEMINI_API_KEY=
# Canva Connect integration (canva.com/developers → Your integrations)
CANVA_CLIENT_ID=
CANVA_CLIENT_SECRET=
# Must exactly match a redirect URL registered on the integration
CANVA_REDIRECT_URI=http://127.0.0.1:3000/api/canva/callback
# Any random string of 32+ chars, e.g. `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`
CANVA_SESSION_SECRET=
```

`.gitignore` ignores `.env*`, so add `!.env.example` to `.gitignore`.

- [ ] **Step 3: Verify.** Run `npm run build`. Expected: build succeeds. Then run `npm run dev` without Canva env vars and run `curl http://127.0.0.1:3000/api/canva/status`. Expected: `{"enabled":false,"connected":false}`.
- [ ] **Step 4: Commit** `git add lib/canva/session.js app/api/canva .env.example .gitignore && git commit -m "feat(canva): add OAuth connect/callback/status routes with encrypted cookie session"`

---

### Task 4: Import + poll routes

**Files:** Create `app/api/canva/import/route.js`, `app/api/canva/import/[jobId]/route.js`, `lib/canva/withCanva.js`. Modify `vercel.json`.

**Consumes:** `readTokens`/`writeTokens`/`clearTokens` (Task 3), `ensureFreshTokens`/`createImportJob`/`getImportJob`/`CanvaApiError` (Task 2).
**Produces:** `POST /api/canva/import?title=<t>` with raw `.pptx` body → `{jobId}`, or `401 {error, needsConnect: true}`. `GET /api/canva/import/:jobId` → `{status, editUrl, error}`.

- [ ] **Step 1: Shared helper so both routes refresh and persist tokens the same way**

```js
// lib/canva/withCanva.js
// Loads the Canva session, refreshes the access token if needed (persisting
// the single-use refresh token), runs fn(accessToken), and maps auth errors
// to a 401 the client turns into a "Connect Canva" prompt.
const { getCanvaConfig, ensureFreshTokens, CanvaApiError } = require('./client');
const { readTokens, writeTokens, clearTokens } = require('./session');

async function withCanva(fn) {
  const config = getCanvaConfig();
  if (!config) return Response.json({ error: 'Canva is not configured on this server.' }, { status: 503 });

  const stored = await readTokens(config);
  if (!stored) return Response.json({ error: 'Connect your Canva account first.', needsConnect: true }, { status: 401 });

  try {
    const { tokens, refreshed } = await ensureFreshTokens(config, stored);
    if (refreshed) await writeTokens(config, tokens);
    return Response.json(await fn(tokens.accessToken));
  } catch (error) {
    if (error instanceof CanvaApiError && (error.status === 400 || error.status === 401)) {
      await clearTokens();
      return Response.json({ error: 'Your Canva sign-in expired. Connect again.', needsConnect: true }, { status: 401 });
    }
    console.error('canva error:', error);
    return Response.json({ error: error.message || 'Canva request failed.' }, { status: 502 });
  }
}

module.exports = { withCanva };
```

Note: a token-endpoint 400 means an invalid or used refresh token, so we reset the session. An import 400 (bad file) is reported by Canva as a job `failed` status, not as an HTTP error, so this mapping doesn't hide it.

- [ ] **Step 2: Routes**

```js
// app/api/canva/import/route.js
import { createImportJob } from '@/lib/canva/client';
import { withCanva } from '@/lib/canva/withCanva';

export async function POST(request) {
  const title = new URL(request.url).searchParams.get('title') || '';
  const bytes = Buffer.from(await request.arrayBuffer());
  if (bytes.length === 0) return Response.json({ error: 'No .pptx file was sent.' }, { status: 400 });

  return withCanva(async (accessToken) => {
    const job = await createImportJob(accessToken, { title, bytes });
    return { jobId: job.id };
  });
}
```

```js
// app/api/canva/import/[jobId]/route.js
import { getImportJob } from '@/lib/canva/client';
import { withCanva } from '@/lib/canva/withCanva';

export async function GET(request, { params }) {
  const { jobId } = await params;
  return withCanva(async (accessToken) => {
    const job = await getImportJob(accessToken, jobId);
    return { status: job.status, editUrl: job.editUrl, error: job.error };
  });
}
```

- [ ] **Step 3:** Add `"app/api/canva/import/route.js": { "maxDuration": 30 }` to `vercel.json` `functions`.
- [ ] **Step 4: Verify.** Run `npm run build`. Expected: success. Run `curl -X POST --data-binary @scripts/test-output.pptx "http://127.0.0.1:3000/api/canva/import?title=Test"` with no session cookie. Expected: `401` with `needsConnect: true`. (Generate the file first with `node scripts/test-pptx.js`.)
- [ ] **Step 5: Commit** `git add lib/canva/withCanva.js app/api/canva/import vercel.json && git commit -m "feat(canva): add design import and job polling routes"`

---

### Task 5: Browser helper + UI

**Files:** Create `lib/canva/browser.js`. Modify `app/page.js`, `app/page.module.css`.

**Consumes:** the `/api/canva/*` routes (Tasks 3–4).
**Produces:** `connectCanvaPopup(): Promise<boolean>`, `importDeckToCanva(blob, title, onStatus): Promise<string /* editUrl */>` (throws `Error` with `.needsConnect` when a sign-in is required).

- [ ] **Step 1: `lib/canva/browser.js`** (ES module, client-only)

```js
// lib/canva/browser.js
// Client-side helpers for the "Open in Canva" button.

export function connectCanvaPopup() {
  return new Promise((resolve) => {
    const popup = window.open('/api/canva/connect', 'canva-auth', 'width=600,height=760');
    if (!popup) return resolve(false);

    let done = false;
    const finish = (ok) => {
      if (done) return;
      done = true;
      window.removeEventListener('message', onMessage);
      clearInterval(timer);
      resolve(ok);
    };
    const onMessage = (e) => {
      if (e.origin === window.location.origin && e.data?.type === 'canva-auth') finish(Boolean(e.data.ok));
    };
    // If the popup closes without a message (or the message raced the close),
    // ask the server whether the session cookie landed.
    const timer = setInterval(async () => {
      if (!popup.closed) return;
      clearInterval(timer);
      const res = await fetch('/api/canva/status').then((r) => r.json()).catch(() => ({}));
      finish(Boolean(res.connected));
    }, 500);
    window.addEventListener('message', onMessage);
  });
}

const POLL_INTERVAL_MS = 2000;
const POLL_ATTEMPTS = 45; // ~90s

export async function importDeckToCanva(blob, title, onStatus) {
  onStatus('Uploading your deck to Canva...');
  const res = await fetch(`/api/canva/import?title=${encodeURIComponent(title)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/octet-stream' },
    body: blob,
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(res.status === 413 ? 'This deck is too large to send to Canva from here. Upload the downloaded file at canva.com instead.' : json.error || 'Canva import failed.');
    err.needsConnect = Boolean(json.needsConnect);
    throw err;
  }

  onStatus('Canva is converting your deck...');
  for (let i = 0; i < POLL_ATTEMPTS; i++) {
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
    const poll = await fetch(`/api/canva/import/${encodeURIComponent(json.jobId)}`);
    const job = await poll.json().catch(() => ({}));
    if (!poll.ok) throw new Error(job.error || 'Could not check the Canva import.');
    if (job.status === 'success' && job.editUrl) return job.editUrl;
    if (job.status === 'failed') throw new Error(job.error || 'Canva could not import this deck.');
  }
  throw new Error('Canva is taking too long. Check "Recent designs" in Canva in a minute.');
}
```

- [ ] **Step 2: `app/page.js` changes**
  - `import { useEffect, useState } from "react";` and `import { connectCanvaPopup, importDeckToCanva } from "@/lib/canva/browser";`
  - New state: `const [deck, setDeck] = useState(null); // { blob, title }`, `const [canva, setCanva] = useState({ enabled: false, connected: false });`, `const [canvaStatus, setCanvaStatus] = useState("");`, `const [canvaError, setCanvaError] = useState("");`, `const [canvaUrl, setCanvaUrl] = useState("");`, `const [canvaBusy, setCanvaBusy] = useState(false);`
  - On mount: `useEffect(() => { fetch("/api/canva/status").then((r) => r.json()).then(setCanva).catch(() => {}); }, []);`
  - In `handleSubmit`: at the start, run `setDeck(null); setCanvaUrl(""); setCanvaError("");`. After `const blob = await pptxRes.blob();`, run `setDeck({ blob, title: topic || subject || "Lesson deck" });`. The download code is unchanged.
  - Add:

```js
  async function handleOpenInCanva() {
    setCanvaError("");
    setCanvaUrl("");
    setCanvaBusy(true);
    try {
      if (!canva.connected) {
        setCanvaStatus("Waiting for Canva sign-in...");
        const ok = await connectCanvaPopup();
        if (!ok) throw new Error("Canva sign-in didn't finish. If your account isn't allowed yet, upload the downloaded file at canva.com.");
        setCanva((c) => ({ ...c, connected: true }));
      }
      const editUrl = await importDeckToCanva(deck.blob, deck.title, setCanvaStatus);
      setCanvaUrl(editUrl);
      setCanvaStatus("");
    } catch (err) {
      if (err.needsConnect) setCanva((c) => ({ ...c, connected: false }));
      setCanvaError(err.message || "Canva import failed.");
      setCanvaStatus("");
    } finally {
      setCanvaBusy(false);
    }
  }
```

  - Below the status/error divs, render:

```jsx
      {deck && (
        <div className={styles.canvaPanel}>
          {canva.enabled && (
            <button type="button" className={styles.submit} onClick={handleOpenInCanva} disabled={canvaBusy}>
              {canvaBusy ? "Sending to Canva..." : canva.connected ? "Open in Canva" : "Connect Canva & open"}
            </button>
          )}
          {canvaStatus && <div className={styles.status}>{canvaStatus}</div>}
          {canvaError && <div className={styles.error}>{canvaError}</div>}
          {canvaUrl && (
            <a className={styles.canvaLink} href={canvaUrl} target="_blank" rel="noopener noreferrer">
              Your deck is ready in Canva — open it →
            </a>
          )}
          <p className={styles.canvaHint}>
            Prefer doing it by hand? In Canva, choose <strong>Upload</strong> (or Create → Import file) and pick the downloaded .pptx.
          </p>
        </div>
      )}
```

- [ ] **Step 3: CSS.** Add to `app/page.module.css`: `.canvaPanel { margin-top: 1.5rem; display: flex; flex-direction: column; gap: .75rem; }`, `.canvaLink { font-weight: 600; }`, and `.canvaHint { font-size: .85rem; opacity: .75; margin: 0; }`.
- [ ] **Step 4: Verify.** Run `npm run lint && npm run build`. Expected: no errors. Run `npm run dev` with no Canva env vars and generate a deck at `http://127.0.0.1:3000`. Expected: the deck downloads, the manual hint shows, and there is no Canva button.
- [ ] **Step 5: Commit** `git add lib/canva/browser.js app/page.js app/page.module.css && git commit -m "feat(canva): add Open in Canva button with popup sign-in and import polling"`

---

### Task 6: Docs + end-to-end check with a real Canva integration

**Files:** Modify `.claude/Skills/module-to-ppt-converter/SKILL.md`, `README.md`.

- [ ] **Step 1: Docs.** In SKILL.md, replace "No Canva account/API is used anywhere…" with a "Canva (optional)" section. List the `lib/canva/*` files and `/api/canva/*` routes, the four env vars, the cookie-only session, the single-use refresh token rule, the popup sign-in, and the "public integration in draft = developer-only until Canva review" constraint. In README, replace the boilerplate with: what the app does, the env vars (point to `.env.example`), `npm run dev` browsed at `http://127.0.0.1:3000`, `npm test`, and the Canva setup steps below.
- [ ] **Step 2: Canva developer setup** (the user does this; it needs their Canva login):
  1. Go to canva.com/developers → Your integrations → **Create an integration** → choose **Public**. The type can't be changed later.
  2. Scopes: enable **design:content:write**. If the import poll returns 403, also enable `design:meta:read` and add it to `SCOPES` in `lib/canva/client.js`.
  3. Authentication → add the redirect URLs `http://127.0.0.1:3000/api/canva/callback` and `https://<your-app>.vercel.app/api/canva/callback`.
  4. Copy the Client ID and generate a Client secret into `.env.local`. Set `CANVA_SESSION_SECRET` too.
- [ ] **Step 3: E2E.** Run `npm run dev` and open `http://127.0.0.1:3000`, not `localhost`. Generate a 4-day topic deck, click **Connect Canva & open**, sign in through the popup, and wait for the link. Expected: the link opens the deck in Canva with the cover, overview and per-day slides. Click again: there is no popup this time and a second design is created. Then delete the `canva_session` cookie and click again. Expected: the popup comes back.
- [ ] **Step 4: Regression.** Run `npm test` (all pass). Then run the existing SKILL.md checks: both generation modes still download a complete `.pptx`, and so does a run with a bad `GEMINI_API_KEY`.
- [ ] **Step 5: Commit** `git add README.md .claude/Skills && git commit -m "docs: document optional Canva integration and setup"`
- [ ] **Step 6 (later, user's call):** Once it works for you, submit the integration for Canva review in the Developer Portal so co-teachers can connect. Then add the production env vars in Vercel.

## Known limits (accepted)

- Vercel caps request bodies at about 4.5 MB. A deck with large Gemini images could go over that on `/api/canva/import`. The client then shows the manual-upload message (413 handling in `browser.js`). The existing `/api/build-pptx` request already carries the same images as base64, so decks that build fine will usually fit.
- Canva drops charts, SmartArt and WordArt on import. `pptxTemplate.js` doesn't use any of them.
