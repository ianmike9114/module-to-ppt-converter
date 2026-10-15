const Groq = require('groq-sdk');
const { MODEL_FALLBACK_CHAIN, maxTokensForModel, MAX_RETRIES, RETRY_BASE_SECONDS } = require('./config');
const { validateDaySplitModule } = require('./schema');

// Adapted from DepEd-AI-System/Apps/ModuleGenerator-Desktop/main/groq-module.js:
// same JSON-only response contract, same fallback-chain + repair-turn pattern,
// but the schema here is a slide-deck day split (4-5 days, 1-2 hrs/day) instead
// of a Module+Worksheet pair.
const SYSTEM_INSTRUCTION = `You are a Philippine DepEd teacher planning a short
weekly lesson deck to be shown as PowerPoint slides in class, spread across
multiple days.

Return ONLY valid JSON matching this exact schema (no markdown fences, no commentary):
{
  "expectations": string[],
  "days": [
    {
      "day": number,
      "title": string,
      "durationHours": number,
      "objectives": string[],
      "content": { "sections": [ { "heading": string, "paragraphs": string[] } ] },
      "activity": { "title": string, "instructions": string, "tasks": string[] },
      "checkForUnderstanding": {
        "items": [ { "question": string, "choices": [string, string, string, string], "correctIndex": 0-3 } ]
      },
      "imagePrompt": string
    }
  ],
  "references": { "books": string[], "onlineSources": string[] }
}

Hard rules:
1. "days" must contain EXACTLY the requested number of days, each with
   "durationHours" inside the requested range — this is a daily-use classroom
   deck, not a single long lecture, so each day must stand on its own with a
   clear start and end.
2. Each day builds on the previous one (Day 1 = introduction/foundation, later
   days = application/practice, last day = synthesis/assessment) — never
   repeat the same content across days.
3. "content.sections" per day should be slide-sized: short headings, 2-4 short
   paragraphs each (a paragraph is a few sentences at most, since this becomes
   slide text, not a textbook page).
4. "activity.tasks" must be concrete, doable within the day's duration, and
   require materials realistically available in a Philippine public school
   classroom.
5. "checkForUnderstanding.items" must contain EXACTLY 3 multiple-choice items
   per day testing only that day's own content. MCQ choices must be
   length-consistent (~3-5 words of each other); never write "All of the
   above" / "None of the above"; never reveal the answer in the question text
   — "correctIndex" alone marks the correct choice.
6. "imagePrompt" is a short (max ~15 words), concrete visual description for
   an illustration to accompany that day's slide (e.g. "a Filipino student
   labeling parts of a plant cell under a microscope") — never text-heavy,
   never a request for text/diagrams-with-labels since it will be an
   AI-generated photo/illustration, not an infographic.
7. Be creative, not formulaic: vary examples, scenarios, and phrasing across
   days; use plain, encouraging language suited to the stated grade level;
   ground examples in Philippine classroom/workplace contexts where relevant.
8. "references.books" and "references.onlineSources" may be empty arrays if no
   real source is available — never invent a fake citation or URL.
9. If existing module content is supplied as reference material below, your
   job is to REORGANIZE and SPLIT that content across the days — do not
   invent unrelated new subject matter, stay faithful to what's given.`;

// Uploaded module text is capped so system instruction + prompt + max_tokens
// fits the 8000 free-tier TPM (lib/config.js). ~6000 chars ≈ 1700 tokens.
const MAX_EXISTING_CONTENT_CHARS = 6000;

function capContent(text) {
  if (text.length <= MAX_EXISTING_CONTENT_CHARS) return text;
  return text.slice(0, MAX_EXISTING_CONTENT_CHARS) + '\n[...module text truncated to fit the AI request limit...]';
}

function buildPrompt(params) {
  const { subject, gradeLevel, topic, totalDays, hoursPerDay, existingContent } = params;

  const lines = [
    `Subject: ${subject}`,
    `Grade Level: ${gradeLevel}`,
    `Topic: ${topic}`,
    `Number of days: exactly ${totalDays}`,
    `Hours per day: approximately ${hoursPerDay} (must be between 1 and 2)`,
  ];

  if (existingContent) {
    lines.push(
      '',
      'Existing module content to reorganize and split across the days (reference material, stay faithful to it, do not invent unrelated new content):',
      capContent(existingContent)
    );
  } else {
    lines.push('', 'No existing content was supplied — draft the full lesson content yourself from the topic above.');
  }

  return lines.join('\n');
}

function buildRepairPrompt(previousResponseText, errors) {
  return [
    'Your previous JSON response had the following problems:',
    ...errors.map((e) => `- ${e}`),
    '',
    'Here is your previous response:',
    previousResponseText,
    '',
    'Return a corrected JSON response fixing ONLY these problems, following the exact schema and rules from the system instruction.',
  ].join('\n');
}

function extractJson(text) {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const raw = fenced ? fenced[1] : text;
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  if (start === -1 || end === -1) throw new Error('No JSON object found in AI response.');
  return JSON.parse(raw.slice(start, end + 1));
}

async function callModel(client, model, messages) {
  const request = {
    model,
    messages,
    temperature: 0.7,
    response_format: { type: 'json_object' },
    max_tokens: maxTokensForModel(model),
  };
  // gpt-oss are reasoning models: unchecked, they spend the tight completion
  // budget on hidden reasoning and return truncated/empty JSON. Same guard as
  // ModuleGenerator-Desktop's groq-module.js.
  if (/^openai\/gpt-oss/.test(model)) request.reasoning_effort = 'low';
  const completion = await client.chat.completions.create(request);
  return completion.choices[0].message.content;
}

// 404 (model gone), 413 (request too large) and other 4xx won't succeed on a
// retry of the same model, so skip straight to the next one instead of
// burning the route's 60s budget on backoff waits. Rate limits (429), server
// errors and bad/invalid JSON (no status) are worth retrying.
function isRetryableError(error) {
  const status = error && error.status;
  if (typeof status !== 'number') return true;
  return status === 429 || status >= 500;
}

async function generateDaySplitModule(params) {
  const { groqApiKey } = params;
  if (!groqApiKey) throw new Error('Groq API key is not set on the server (GROQ_API_KEY).');

  const client = new Groq({ apiKey: groqApiKey });
  const userPrompt = buildPrompt(params);

  let lastError;
  for (const model of MODEL_FALLBACK_CHAIN) {
    const messages = [
      { role: 'system', content: SYSTEM_INSTRUCTION },
      { role: 'user', content: userPrompt },
    ];

    for (let attempt = 0; attempt < MAX_RETRIES; attempt += 1) {
      try {
        let responseText = await callModel(client, model, messages);
        let parsed = extractJson(responseText);
        let errors = validateDaySplitModule(parsed, params);

        if (errors.length > 0) {
          const repairMessages = [
            ...messages,
            { role: 'assistant', content: responseText },
            { role: 'user', content: buildRepairPrompt(responseText, errors) },
          ];
          responseText = await callModel(client, model, repairMessages);
          parsed = extractJson(responseText);
          errors = validateDaySplitModule(parsed, params);
          if (errors.length > 0) {
            throw new Error(`AI response failed validation after repair: ${errors.join('; ')}`);
          }
        }

        return { data: parsed, model, fallback: model !== MODEL_FALLBACK_CHAIN[0] };
      } catch (error) {
        lastError = error;
        if (!isRetryableError(error)) break;
        if (attempt < MAX_RETRIES - 1) {
          await new Promise((resolve) => setTimeout(resolve, RETRY_BASE_SECONDS * 1000 * (attempt + 1)));
        }
      }
    }
  }

  throw lastError || new Error('Lesson deck generation failed for all models.');
}

module.exports = { generateDaySplitModule, SYSTEM_INSTRUCTION, buildPrompt, isRetryableError, MAX_EXISTING_CONTENT_CHARS };
