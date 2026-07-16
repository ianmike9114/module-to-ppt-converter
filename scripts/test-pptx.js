const fs = require('fs');
const path = require('path');
const { buildLessonPptx } = require('../lib/pptxTemplate');

const mockData = {
  meta: { subject: 'Science', gradeLevel: '9', topic: 'Cell Biology', totalDays: 4, hoursPerDay: 1 },
  expectations: ['Describe the structure of plant and animal cells', 'Compare plant and animal cell organelles'],
  days: [1, 2, 3, 4].map((day) => ({
    day,
    title: `Day ${day} Lesson`,
    durationHours: 1,
    objectives: ['Objective A', 'Objective B'],
    content: { sections: [{ heading: 'Intro', paragraphs: ['Paragraph one.', 'Paragraph two.'] }] },
    activity: { title: 'Group Activity', instructions: 'Work in pairs.', tasks: ['Task 1', 'Task 2'] },
    checkForUnderstanding: {
      items: [1, 2, 3].map((i) => ({
        question: `Question ${i}?`,
        choices: ['A choice here', 'B choice here', 'C choice here', 'D choice here'],
        correctIndex: 0,
      })),
    },
    imagePrompt: 'a student looking through a microscope',
  })),
  references: { books: [], onlineSources: [] },
};

(async () => {
  const buffer = await buildLessonPptx(mockData, []);
  const outPath = path.join(__dirname, 'test-output.pptx');
  fs.writeFileSync(outPath, buffer);
  console.log('Wrote', outPath, buffer.length, 'bytes');
})();
