const { GoogleGenerativeAI } = require('@google/generative-ai');

// Gemini free tier (Google AI Studio) image generation. Free tier is rate
// limited (a handful of images/minute), so every call here is best-effort:
// callers must treat a null return as "skip this image," never as fatal —
// the deck still builds without it (see /api/generate-images).
const IMAGE_MODEL = 'gemini-2.0-flash-preview-image-generation';

async function generateImage(prompt, geminiApiKey) {
  if (!geminiApiKey) return null;

  try {
    const genAI = new GoogleGenerativeAI(geminiApiKey);
    const model = genAI.getGenerativeModel({ model: IMAGE_MODEL });

    const result = await model.generateContent({
      contents: [{ role: 'user', parts: [{ text: `A clean, classroom-appropriate illustration: ${prompt}` }] }],
      generationConfig: { responseModalities: ['TEXT', 'IMAGE'] },
    });

    const parts = result.response?.candidates?.[0]?.content?.parts || [];
    const imagePart = parts.find((p) => p.inlineData && p.inlineData.data);
    if (!imagePart) return null;

    return {
      base64: imagePart.inlineData.data,
      mimeType: imagePart.inlineData.mimeType || 'image/png',
    };
  } catch (error) {
    console.error(`Gemini image generation failed for prompt "${prompt}":`, error.message);
    return null;
  }
}

async function generateImagesForDays(days, geminiApiKey) {
  const results = [];
  for (const day of days) {
    // Sequential, not Promise.all — free-tier rate limits are per-minute, so
    // parallel requests just trade a slow loop for a wave of 429s.
    const image = await generateImage(day.imagePrompt, geminiApiKey);
    results.push(image);
  }
  return results;
}

module.exports = { generateImage, generateImagesForDays };
