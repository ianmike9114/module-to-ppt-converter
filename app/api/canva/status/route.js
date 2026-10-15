import { getCanvaConfig } from '@/lib/canva/client';
import { readTokens } from '@/lib/canva/session';

export async function GET() {
  const config = getCanvaConfig();
  if (!config) return Response.json({ enabled: false, connected: false });
  const tokens = await readTokens(config);
  return Response.json({ enabled: true, connected: Boolean(tokens?.refreshToken) });
}
