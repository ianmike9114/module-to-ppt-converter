const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { extractModuleText } = require('../lib/extractText');

test('extracts text from a PDF', async () => {
  const buffer = fs.readFileSync(path.join(__dirname, 'fixtures', 'sample.pdf'));
  const text = await extractModuleText('Module_Wk4.PDF', buffer);
  assert.match(text, /Hello Module Text/);
});

test('reads .txt as utf-8', async () => {
  assert.strictEqual(await extractModuleText('notes.txt', Buffer.from('  Aralin 1  ')), 'Aralin 1');
});

test('rejects unsupported file types instead of sending binary to the AI', async () => {
  await assert.rejects(extractModuleText('slides.pptx', Buffer.from('PK...')), /\.docx, \.pdf, or \.txt/);
});

test('rejects a PDF with no extractable text (scanned images)', async () => {
  await assert.rejects(extractModuleText('scan.pdf', Buffer.from('%PDF-1.4 not really')), /PDF/);
});
