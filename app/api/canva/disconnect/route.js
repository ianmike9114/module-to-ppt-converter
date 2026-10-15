import { clearTokens } from '@/lib/canva/session';

export async function POST() {
  await clearTokens();
  return Response.json({ ok: true });
}
