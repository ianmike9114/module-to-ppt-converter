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
