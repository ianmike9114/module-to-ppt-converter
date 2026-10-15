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
