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
