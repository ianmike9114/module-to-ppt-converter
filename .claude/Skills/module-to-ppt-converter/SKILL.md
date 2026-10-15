---
name: module-to-ppt-converter
description: Web app that converts a DepEd learning module (or just a topic) into a 4-5 day, 1-2 hour/day PowerPoint lesson deck, using Groq for content generation and Gemini for per-day images. Use whenever a task involves this app's Groq/Gemini prompts, the day-split lesson schema, the pptxgenjs slide template, its API routes, or deploying/configuring it on Vercel.
---

# Module to PPT Converter

A standalone Next.js (App Router) web app, separate from the user's
`DepEd-AI-System` desktop apps. A teacher pastes/uploads an existing module
or just gives a topic, and gets back a downloadable `.pptx` split into 4-5
daily sessions of 1-2 hours each. Hosted so co-teachers can use it from a
browser with no install and no API keys of their own.

## Where things live (do not re-explore)

- `lib/config.js` — Groq model fallback chain + per-model token budgets,
  ported verbatim from `DepEd-AI-System/Apps/ModuleGenerator-Desktop/main/config.js`.
  If Groq deprecates a model (as happened before — see that file's comments),
  update `MODEL_FALLBACK_CHAIN` here too.
- `lib/schema.js` — `validateDaySplitModule()`: the hard-rule validator for the
  day-split JSON schema (see below). Mirrors the validate/repair pattern in
  `ModuleGenerator-Desktop/main/groq-module.js`.
- `lib/groq.js` — `generateDaySplitModule()`: builds the prompt, calls Groq
  with `response_format: json_object`, validates, and on failure sends one
  repair turn before falling back to the next model in the chain. Two modes,
  both handled by the same `SYSTEM_INSTRUCTION`/`buildPrompt()`: drafting from
  a bare topic, or reorganizing `existingContent` (extracted text from an
  uploaded module) into days — the prompt explicitly forbids inventing new
  subject matter in the latter case.
- `lib/gemini.js` — `generateImagesForDays()`: one Gemini
  (`gemini-2.0-flash-preview-image-generation`) call per day, sequential (not
  parallel — free-tier rate limits are per-minute). Every call is best-effort:
  a failure returns `null` for that day rather than throwing, so a rate-limited
  or missing key never blocks the deck from building.
- `lib/pptxTemplate.js` — `buildLessonPptx()`: the slide builder, adapted from
  `DepEd-AI-System/Apps/DLLGenerator-Desktop/main/pptx-builder.js`'s
  `LAYOUT_WIDE` cover/overview/per-day-slides structure. Per day: an intro
  slide (objectives + optional image), one slide per content section, an
  activity slide, and a check-for-understanding slide. Same convention as the
  DLL app: correct MCQ answers are marked with a ✅ computed from
  `correctIndex` in code — **never** trust the AI to also announce the answer
  in the question text.
- `app/api/parse-module/route.js` — extracts plain text from an uploaded
  `.docx` (via `mammoth`) or `.txt`/pasted text. No AI call here — just
  extraction, feeding into `existingContent` for `/api/generate-module`.
- `app/api/generate-module/route.js` — calls `generateDaySplitModule()`
  server-side using `process.env.GROQ_API_KEY`. The client never sends or
  holds this key.
- `app/api/generate-images/route.js` — calls `generateImagesForDays()` using
  `process.env.GEMINI_API_KEY`, same server-only-key rule.
- `app/api/build-pptx/route.js` — calls `buildLessonPptx()` and streams the
  `.pptx` back as a file download.
- `app/page.js` — single-page client form: topic vs. existing-module mode,
  days (4-5)/hours-per-day (1-2) selects, an "include AI images" toggle, and
  the fetch chain that calls the four API routes in sequence and triggers the
  browser download.

## The day-split JSON schema

```
{
  meta: { subject, gradeLevel, topic, totalDays, hoursPerDay },
  expectations: string[],
  days: [{
    day, title, durationHours (1-2),
    objectives: string[],
    content: { sections: [{ heading, paragraphs: string[] }] },
    activity: { title, instructions, tasks: string[] },
    checkForUnderstanding: { items: [{ question, choices: string[4], correctIndex }] }, // exactly 3 per day
    imagePrompt: string,
  }],
  references: { books: string[], onlineSources: string[] },
}
```

This is a **different, simpler shape** than `ModuleGenerator-Desktop`'s
Module+Worksheet schema (no tiered Simple/Moderate/Challenging worksheet) —
it's built for daily slide-sized content, not a full self-learning module
document. Don't try to reuse `MODULE_OUTPUT_FORMAT.md`'s schema directly here.

## API keys and where they're configured

Two free keys, both **server-side only** (`.env.local` for dev, Vercel project
Environment Variables for production) — co-teachers using the hosted app
never see or need either:

1. `GROQ_API_KEY` — console.groq.com, same provider as the user's
   `New Application` (todo-widget) Tauri app.
2. `GEMINI_API_KEY` — aistudio.google.com (Google AI Studio) free tier, used
   only for per-day image generation. Rate-limited on the free tier — this is
   why every Gemini call is wrapped to fail soft (see `lib/gemini.js`).

## Deployment

Vercel Hobby (free) tier. `vercel.json` sets `maxDuration` (60s for the two
AI-calling routes, 30s for pptx assembly) since Hobby's serverless default is
too short for a Groq + several sequential Gemini calls. Slide design is
self-styled via `pptxgenjs`; Canva is only an optional "open the finished
deck in Canva" step (below), never part of generation.

## Canva (optional "Open in Canva")

After a deck is generated, `app/page.js` keeps the `.pptx` Blob and shows an
"Open in Canva" button that imports it into the teacher's own Canva account
via the Canva Connect **Design Import** API, then links to the edit URL.

- `lib/canva/client.js` — Connect REST client (OAuth PKCE token calls,
  `createImportJob`, `getImportJob`); `fetch` is injectable for tests.
  Scope is `design:content:write` only (`SCOPES` constant).
- `lib/canva/seal.js` + `lib/canva/session.js` — tokens live in an
  AES-256-GCM encrypted httpOnly cookie (`canva_session`); the PKCE
  verifier/state in a 10-minute `canva_oauth` cookie. No database.
- `lib/canva/withCanva.js` — shared route wrapper: refreshes the access token
  when near expiry and **always rewrites the cookie** (Canva refresh tokens
  are single-use); auth failures → 401 `{needsConnect: true}`.
- `lib/canva/browser.js` — client helpers: sign-in runs in a **popup**
  (`/api/canva/connect` → Canva → `/api/canva/callback`, which postMessages
  the opener and closes) so the in-memory deck isn't lost; then upload +
  poll the import job.
- Routes: `/api/canva/{status,connect,callback,disconnect,import,import/[jobId]}`.
- Env vars (server-only, see `.env.example`): `CANVA_CLIENT_ID`,
  `CANVA_CLIENT_SECRET`, `CANVA_REDIRECT_URI`, `CANVA_SESSION_SECRET` (32+
  chars). If any is missing, `/api/canva/status` reports `enabled: false` and
  the UI shows only manual upload instructions.
- The integration is a **Public** Canva integration. Until Canva reviews it,
  only the developer's own Canva account can connect; co-teachers fall back
  to the manual upload hint.
- Local dev must be browsed at `http://127.0.0.1:3000` (matches the
  registered redirect URL, so the OAuth cookie host matches).
- Known limit: Vercel's ~4.5 MB request body cap applies to the import
  upload; a 413 shows the manual-upload message.

## Verifying changes

`npm test` runs `node:test` unit tests for `lib/canva/*` (no network).
Otherwise there's no test suite. After any change: run `npm run dev`, submit the form in
both modes (topic-only, and pasted/uploaded existing content), confirm the
downloaded `.pptx` opens and shows the requested day count with the
intro/content/activity/check-for-understanding slide sequence per day, and
that a missing/invalid `GEMINI_API_KEY` still produces a complete deck
(without images) rather than an error.
