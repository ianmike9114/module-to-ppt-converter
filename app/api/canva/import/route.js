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
