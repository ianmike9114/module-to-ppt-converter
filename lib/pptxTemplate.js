const PptxGenJS = require('pptxgenjs');

// Adapted from DepEd-AI-System/Apps/DLLGenerator-Desktop/main/pptx-builder.js:
// same LAYOUT_WIDE + cover/overview/per-day-slides structure and the
// correctIndex-computed-in-code answer marking convention, retargeted from
// DLL data to a day-split lesson-deck schema (lib/schema.js) with optional
// per-day AI-generated images.
const ACCENT = '0D7377';
const DARK = '1A1A2E';
const CORRECT = '2E7D32';
const LIGHT_BG = 'F4F6F5';

function bulletLines(items) {
  return (items || []).filter(Boolean).map((t) => ({ text: t, options: { bullet: true, breakLine: true } }));
}

function paragraphLines(paragraphs) {
  return (paragraphs || []).filter(Boolean).map((t) => ({ text: t, options: { breakLine: true, paraSpaceAfter: 8 } }));
}

function coverSlide(pres, data) {
  const slide = pres.addSlide();
  slide.background = { color: LIGHT_BG };
  slide.addText(String(data.meta?.subject || '').toUpperCase(), {
    x: 0, y: 0.5, w: '100%', align: 'center', fontSize: 16, color: ACCENT, bold: true,
  });
  slide.addText(data.meta?.topic || 'Weekly Lesson Deck', {
    x: 0.8, y: 1.6, w: 11.7, align: 'center', fontSize: 34, bold: true, color: DARK,
  });
  const lines = [
    data.meta?.gradeLevel ? `Grade ${data.meta.gradeLevel}` : '',
    `${data.days?.length || 0}-Day Lesson (${data.meta?.hoursPerDay || 1} hr/day)`,
  ].filter(Boolean);
  slide.addText(lines.join('   |   '), { x: 0.8, y: 3.4, w: 11.7, align: 'center', fontSize: 16, color: DARK });
}

function overviewSlide(pres, data) {
  const slide = pres.addSlide();
  slide.addText('Weekly Overview', { x: 0.4, y: 0.3, fontSize: 24, bold: true, color: ACCENT });

  slide.addText('Learning Objectives', { x: 0.4, y: 0.9, fontSize: 14, bold: true, color: DARK });
  slide.addText(bulletLines(data.expectations), { x: 0.4, y: 1.25, w: 5.8, h: 2.8, fontSize: 11, color: DARK });

  slide.addText('Day-by-Day Agenda', { x: 6.6, y: 0.9, fontSize: 14, bold: true, color: DARK });
  const agenda = (data.days || []).map((d) => `Day ${d.day}: ${d.title} (${d.durationHours} hr)`);
  slide.addText(bulletLines(agenda), { x: 6.6, y: 1.25, w: 5.8, h: 2.8, fontSize: 11, color: DARK });

  const refs = [
    ...(data.references?.books || []).map((b) => `Book: ${b}`),
    ...(data.references?.onlineSources || []).map((s) => `Online: ${s}`),
  ];
  if (refs.length) {
    slide.addText('References', { x: 0.4, y: 4.3, fontSize: 14, bold: true, color: DARK });
    slide.addText(bulletLines(refs), { x: 0.4, y: 4.65, w: 12, h: 1.8, fontSize: 10, color: DARK });
  }
}

function addDayImage(slide, image, x, y, w, h) {
  if (!image || !image.base64) return false;
  slide.addImage({ data: `data:${image.mimeType};base64,${image.base64}`, x, y, w, h });
  return true;
}

function dayIntroSlide(pres, day, image) {
  const slide = pres.addSlide();
  slide.addText(`Day ${day.day} — ${day.title}`, { x: 0.4, y: 0.3, w: 12.5, fontSize: 22, bold: true, color: ACCENT });
  slide.addText(`Duration: ${day.durationHours} hour(s)`, { x: 0.4, y: 1.0, fontSize: 12, color: DARK });

  const hasImage = image && image.base64;
  const textW = hasImage ? 7.2 : 12.5;

  slide.addText('Objectives', { x: 0.4, y: 1.5, fontSize: 14, bold: true, color: DARK });
  slide.addText(bulletLines(day.objectives), { x: 0.4, y: 1.85, w: textW, h: 4.5, fontSize: 13, color: DARK });

  if (hasImage) {
    addDayImage(slide, image, 8.0, 1.6, 4.6, 4.6);
  }
}

function contentSlide(pres, day, section, index) {
  const slide = pres.addSlide();
  slide.addText(`Day ${day.day} — ${section.heading || `Content ${index + 1}`}`, {
    x: 0.4, y: 0.3, w: 12.5, fontSize: 20, bold: true, color: ACCENT,
  });
  slide.addText(paragraphLines(section.paragraphs), { x: 0.4, y: 1.1, w: 12.5, h: 5.8, fontSize: 14, color: DARK });
}

function activitySlide(pres, day) {
  const slide = pres.addSlide();
  slide.addText(`Day ${day.day} — Activity: ${day.activity?.title || ''}`, {
    x: 0.4, y: 0.3, w: 12.5, fontSize: 20, bold: true, color: ACCENT,
  });
  if (day.activity?.instructions) {
    slide.addText(day.activity.instructions, { x: 0.4, y: 1.1, w: 12.5, h: 1.0, fontSize: 13, italic: true, color: DARK });
  }
  slide.addText(bulletLines(day.activity?.tasks), { x: 0.4, y: 2.2, w: 12.5, h: 4.5, fontSize: 13, color: DARK });
}

function checkLines(items = []) {
  const lines = [];
  items.forEach((item, i) => {
    lines.push({ text: `${i + 1}. ${item.question || ''}`, options: { breakLine: true, bold: true } });
    (item.choices || []).forEach((choice, ci) => {
      const letter = 'ABCD'[ci];
      const isCorrect = ci === item.correctIndex;
      lines.push({
        text: `${letter}. ${choice}${isCorrect ? ' ✅' : ''}`,
        options: { breakLine: true, indentLevel: 1, color: isCorrect ? CORRECT : DARK, bold: isCorrect },
      });
    });
  });
  return lines.length ? lines : [{ text: '', options: {} }];
}

function checkForUnderstandingSlide(pres, day) {
  const slide = pres.addSlide();
  slide.addText(`Day ${day.day} — Check for Understanding`, {
    x: 0.4, y: 0.3, w: 12.5, fontSize: 20, bold: true, color: ACCENT,
  });
  slide.addText(checkLines(day.checkForUnderstanding?.items), { x: 0.4, y: 1.0, w: 12.5, h: 6.0, fontSize: 12, color: DARK });
}

async function buildLessonPptx(data, images = []) {
  const pres = new PptxGenJS();
  pres.layout = 'LAYOUT_WIDE';

  coverSlide(pres, data);
  overviewSlide(pres, data);

  (data.days || []).forEach((day, i) => {
    const image = images[i];
    dayIntroSlide(pres, day, image);
    (day.content?.sections || []).forEach((section, si) => contentSlide(pres, day, section, si));
    activitySlide(pres, day);
    checkForUnderstandingSlide(pres, day);
  });

  return pres.write({ outputType: 'nodebuffer' });
}

module.exports = { buildLessonPptx };
