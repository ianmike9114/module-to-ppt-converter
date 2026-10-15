# Module → PPT Converter

Turns a DepEd learning module (uploaded `.docx`/`.txt` or pasted text) or just a topic into a 4–5 day PowerPoint lesson deck, split into 1–2 hour daily sessions. Groq writes the content, Gemini makes optional per-day images, and `pptxgenjs` builds the slides. Optionally, the finished deck opens straight in Canva for restyling.

## Setup

```bash
npm install
cp .env.example .env.local   # then fill in the keys
npm run dev
```

Open **http://127.0.0.1:3000** (use `127.0.0.1`, not `localhost`, so the Canva sign-in redirect matches).

| Env var | Required | Where to get it |
|---|---|---|
| `GROQ_API_KEY` | yes | console.groq.com |
| `GEMINI_API_KEY` | no (images skipped without it) | aistudio.google.com |
| `CANVA_CLIENT_ID`, `CANVA_CLIENT_SECRET` | no (enables "Open in Canva") | Canva developer portal, see below |
| `CANVA_REDIRECT_URI` | with Canva | `http://127.0.0.1:3000/api/canva/callback` locally |
| `CANVA_SESSION_SECRET` | with Canva | any random 32+ character string |

All keys are server-side only. People using the hosted app never need their own keys.

## "Open in Canva" setup

1. Go to [canva.com/developers](https://www.canva.com/developers/integrations/connect-api) → **Create an integration** → choose **Public** (the type can't be changed later).
2. **Scopes:** enable `design:content:write`.
3. **Authentication → Redirect URLs:** add `http://127.0.0.1:3000/api/canva/callback` and `https://<your-app>.vercel.app/api/canva/callback`.
4. Copy the Client ID and generate a Client secret into `.env.local` (and Vercel env vars for production).
5. Until Canva reviews and approves the integration, only your own Canva account can connect. Submit it for review in the portal when you want co-teachers to use the button. Everyone else always sees manual "upload the .pptx to Canva" instructions.

## Scripts

- `npm run dev`: dev server
- `npm test`: unit tests for the Canva helpers (`node:test`, no network)
- `npm run build` / `npm start`: production build
- `node scripts/test-pptx.js`: writes a sample deck to `scripts/test-output.pptx`

## Deploy

Vercel Hobby tier. `vercel.json` raises `maxDuration` for the AI routes and the Canva import route.
