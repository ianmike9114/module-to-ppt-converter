// Shared internal schema for a day-split lesson deck. One object of this
// shape flows from either /api/generate-module or /api/parse-module into
// /api/generate-images and /api/build-pptx.
//
// {
//   meta: { subject, gradeLevel, topic, totalDays, hoursPerDay },
//   expectations: string[],
//   days: [{
//     day: number,
//     title: string,
//     durationHours: number,
//     objectives: string[],
//     content: { sections: [{ heading, paragraphs: string[] }] },
//     activity: { title, instructions, tasks: string[] },
//     checkForUnderstanding: { items: [{ question, choices: string[4], correctIndex }] },
//     imagePrompt: string,
//     imageBase64: string | null,
//   }],
//   references: { books: string[], onlineSources: string[] },
// }

function validateDaySplitModule(parsed, params) {
  const errors = [];
  const totalDays = params.totalDays || 5;

  if (!Array.isArray(parsed.expectations) || parsed.expectations.length === 0) {
    errors.push('"expectations" must be a non-empty array of strings.');
  }

  if (!Array.isArray(parsed.days) || parsed.days.length !== totalDays) {
    errors.push(`"days" must contain exactly ${totalDays} entries.`);
    return errors;
  }

  parsed.days.forEach((day, i) => {
    if (!day.title) errors.push(`days[${i}] must have a "title".`);
    if (typeof day.durationHours !== 'number' || day.durationHours < 1 || day.durationHours > 2) {
      errors.push(`days[${i}].durationHours must be a number between 1 and 2.`);
    }
    if (!Array.isArray(day.objectives) || day.objectives.length === 0) {
      errors.push(`days[${i}].objectives must be a non-empty array.`);
    }
    if (!day.content || !Array.isArray(day.content.sections) || day.content.sections.length === 0) {
      errors.push(`days[${i}].content.sections must be a non-empty array.`);
    }
    if (!day.activity || !day.activity.title || !Array.isArray(day.activity.tasks) || day.activity.tasks.length === 0) {
      errors.push(`days[${i}].activity must have a "title" and non-empty "tasks" array.`);
    }
    const items = day.checkForUnderstanding && day.checkForUnderstanding.items;
    if (!Array.isArray(items) || items.length !== 3) {
      errors.push(`days[${i}].checkForUnderstanding.items must contain exactly 3 items.`);
    } else {
      items.forEach((item, j) => {
        if (!item.question || !Array.isArray(item.choices) || item.choices.length !== 4) {
          errors.push(`days[${i}].checkForUnderstanding.items[${j}] must have a question and exactly 4 choices.`);
        }
        if (typeof item.correctIndex !== 'number' || item.correctIndex < 0 || item.correctIndex > 3) {
          errors.push(`days[${i}].checkForUnderstanding.items[${j}].correctIndex must be a number 0-3.`);
        }
      });
    }
    if (!day.imagePrompt) errors.push(`days[${i}].imagePrompt must be a short string.`);
  });

  if (!parsed.references || !Array.isArray(parsed.references.books) || !Array.isArray(parsed.references.onlineSources)) {
    errors.push('"references" must have "books" and "onlineSources" arrays (may be empty).');
  }

  return errors;
}

module.exports = { validateDaySplitModule };
