import mammoth from 'mammoth';

// Extracts plain text from an uploaded existing module so it can be passed to
// Groq as "existingContent" reference material in /api/generate-module.
// Supports: .docx (e.g. exported from ModuleGenerator-Desktop), .txt, and
// pasted-text/JSON bodies sent directly as plain text.
export async function POST(request) {
  try {
    const contentType = request.headers.get('content-type') || '';

    if (contentType.includes('multipart/form-data')) {
      const formData = await request.formData();
      const file = formData.get('file');
      if (!file) {
        return Response.json({ error: 'No file uploaded.' }, { status: 400 });
      }

      const arrayBuffer = await file.arrayBuffer();
      const buffer = Buffer.from(arrayBuffer);
      const name = (file.name || '').toLowerCase();

      let extractedText;
      if (name.endsWith('.docx')) {
        const result = await mammoth.extractRawText({ buffer });
        extractedText = result.value;
      } else {
        extractedText = buffer.toString('utf-8');
      }

      return Response.json({ extractedText: extractedText.trim() });
    }

    // Plain pasted text/JSON sent as a JSON body: { text: "..." }
    const body = await request.json();
    return Response.json({ extractedText: (body.text || '').trim() });
  } catch (error) {
    console.error('parse-module error:', error);
    return Response.json({ error: error.message || 'Failed to parse module.' }, { status: 500 });
  }
}
