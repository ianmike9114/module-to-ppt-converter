import { getImportJob } from '@/lib/canva/client';
import { withCanva } from '@/lib/canva/withCanva';

export async function GET(request, { params }) {
  const { jobId } = await params;
  return withCanva(async (accessToken) => {
    const job = await getImportJob(accessToken, jobId);
    return { status: job.status, editUrl: job.editUrl, error: job.error };
  });
}
