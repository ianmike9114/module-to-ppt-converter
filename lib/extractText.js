// Plain-text extraction for uploaded modules (.docx, .pdf, .txt), feeding
// "existingContent" in /api/generate-module. Anything else is rejected —
// reading a binary file as utf-8 used to send megabytes of junk to Groq and
// trip its request-size limit.
const mammoth = require('mammoth');
// Require the library file directly: pdf-parse's index.js runs a debug
// self-test (reading a bundled sample PDF) when module.parent is unset, which
// is the case under Next.js bundling.
const pdfParse = require('pdf-parse/lib/pdf-parse.js');

async function extractModuleText(fileName, buffer) {
  const name = (fileName || '').toLowerCase();

  if (name.endsWith('.docx')) {
    const result = await mammoth.extractRawText({ buffer });
    return result.value.trim();
  }

  if (name.endsWith('.pdf')) {
    let text;
    try {
      ({ text } = await pdfParse(buffer));
    } catch (error) {
      console.error('pdf-parse error:', error);
      throw new Error('Could not read this PDF. Try saving the module as .docx, or paste its text instead.');
    }
    text = (text || '').trim();
    if (!text) {
      throw new Error('This PDF has no selectable text (it may be scanned images). Paste the module text instead.');
    }
    return text;
  }

  if (name.endsWith('.txt')) {
    return buffer.toString('utf-8').trim();
  }

  throw new Error('Unsupported file type. Upload a .docx, .pdf, or .txt module, or paste the text.');
}

module.exports = { extractModuleText };
