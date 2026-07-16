import { generateImagesForDays } from '@/lib/gemini';

// Best-effort image generation: any day whose image call fails (missing key,
// rate limit, etc.) comes back as null and /api/build-pptx simply skips the
// image for that slide rather than failing the whole deck.
export async function POST(request) {
  try {
    const body = await request.json();
    const { days } = body;

    if (!Array.isArray(days) || days.length === 0) {
      return Response.json({ error: '"days" must be a non-empty array.' }, { status: 400 });
    }

    const geminiApiKey = process.env.GEMINI_API_KEY;
    const images = await generateImagesForDays(days, geminiApiKey);

    return Response.json({ images });
  } catch (error) {
    console.error('generate-images error:', error);
    return Response.json({ error: error.message || 'Failed to generate images.' }, { status: 500 });
  }
}
