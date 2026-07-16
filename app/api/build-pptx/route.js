import { buildLessonPptx } from '@/lib/pptxTemplate';

export async function POST(request) {
  try {
    const body = await request.json();
    const { moduleData, images } = body;

    if (!moduleData || !Array.isArray(moduleData.days)) {
      return Response.json({ error: 'moduleData with a "days" array is required.' }, { status: 400 });
    }

    const buffer = await buildLessonPptx(moduleData, images || []);
    const filename = `${(moduleData.meta?.topic || 'lesson-deck').replace(/[^a-z0-9]+/gi, '-').toLowerCase()}.pptx`;

    return new Response(buffer, {
      status: 200,
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
        'Content-Disposition': `attachment; filename="${filename}"`,
      },
    });
  } catch (error) {
    console.error('build-pptx error:', error);
    return Response.json({ error: error.message || 'Failed to build presentation.' }, { status: 500 });
  }
}
