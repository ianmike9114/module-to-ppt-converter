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
    // 400 from the token endpoint = refresh token already used/invalid; 401 = revoked access.
    // Bad-file imports come back as a "failed" job, not an HTTP error, so they aren't hidden here.
    if (error instanceof CanvaApiError && (error.status === 400 || error.status === 401)) {
      await clearTokens();
      return Response.json({ error: 'Your Canva sign-in expired. Connect again.', needsConnect: true }, { status: 401 });
    }
    console.error('canva error:', error);
    return Response.json({ error: error.message || 'Canva request failed.' }, { status: 502 });
  }
}

module.exports = { withCanva };
