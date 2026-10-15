import { extractModuleText } from '@/lib/extractText';

// Extracts plain text from an uploaded existing module so it can be passed to
// Groq as "existingContent" reference material in /api/generate-module.
// Supports: .docx (e.g. exported from ModuleGenerator-Desktop), .pdf, .txt,
// and pasted-text/JSON bodies sent directly as plain text.
export async function POST(request) {
  try {
    const contentType = request.headers.get('content-type') || '';

    if (contentType.includes('multipart/form-data')) {
      const formData = await request.formData();
      const file = formData.get('file');
      if (!file) {
        return Response.json({ error: 'No file uploaded.' }, { status: 400 });
      }

      const buffer = Buffer.from(await file.arrayBuffer());
      try {
        const extractedText = await extractModuleText(file.name, buffer);
        return Response.json({ extractedText });
      } catch (error) {
        return Response.json({ error: error.message }, { status: 400 });
      }
    }

    // Plain pasted text/JSON sent as a JSON body: { text: "..." }
    const body = await request.json();
    return Response.json({ extractedText: (body.text || '').trim() });
  } catch (error) {
    console.error('parse-module error:', error);
    return Response.json({ error: error.message || 'Failed to parse module.' }, { status: 500 });
  }
}
