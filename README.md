# Shivani AI — Personal AI Voice Twin

A deployable voice-first web app for the 100x Stage 1 assessment. It answers in first person using a curated, factual professional profile. The frontend uses browser speech recognition and speech synthesis; the backend calls Groq and keeps the API key server-side.

## Features
- Voice input (Web Speech API) with a text-chat fallback.
- Spoken responses (browser speech synthesis) with a mute control.
- Short conversation context for follow-up questions.
- Curated persona and profile with explicit anti-hallucination instructions.
- Responsive interface, suggested questions, reset conversation, loading/error states.
- No visitor account or API-key entry.

## Architecture

```text
Browser (React/Vite)          FastAPI backend
┌─────────────┐   text + history       ┌──────────────────┐
│  Voice/text │────────────────────────▶│  /api/chat       │
│  (Web Speech API)              │        │                  │
└─────────────┘                      │  • validates input │
                                     │  • manages memory  │
                                     │  • grounds in persona   │
                                     │  • calls Groq API   │
                                     │  • returns answer + conversation_id      │
                                     └──────────────────┘
                                     ▲
                                     │ speechSynthesis (browser)
                                     ▼
                              Spoken answer
```

- All Groq interaction happens on the backend; the API key is never exposed to the browser.
- Follow-up questions keep context server-side per `conversation_id`.
- Reset conversation via `/api/chat/reset`.
- Voice input (Web Speech API) and spoken output (speechSynthesis) run in the browser; text is always available as a fallback.

## API surface

| Method | Path | Purpose |
| ------ | ---- | ------- |
| GET | `/health` | Health + AI config status |
| GET | `/api/profile` | Curated, non-sensitive professional profile |
| GET | `/api/suggestions` | Suggested opening questions |
| POST | `/api/chat` | Send a message + optional history; returns `answer`, `conversation_id`, `model`, `mode` |
| POST | `/api/chat/reset` | Clear the conversation memory and start a fresh `conversation_id` |

Request/response contracts are validated with Pydantic. The backend also includes a small in-memory rate limiter, and long histories are trimmed to stay within a bounded character budget.

## Run locally

Requirements: Python 3.10+ and Node.js 20+.

### 1. Backend

```bash
cd backend
python -m venv .venv
# macOS/Linux
source .venv/bin/activate
# Windows PowerShell: .venv\\Scripts\\Activate.ps1
pip install -r requirements.txt
cp .env.example .env
# Add GROQ_API_KEY to your shell environment (or use a local dotenv loader if you add one).
export GROQ_API_KEY="YOUR_KEY"
uvicorn main:app --reload --port 8000
```

### 2. Frontend

In another terminal:

```bash
cd frontend
npm install
# Optional if backend is not on localhost:8000:
# create .env.local containing VITE_API_URL=http://localhost:8000
npm run dev
```

Open the Vite URL shown in the terminal (usually http://localhost:5173). Microphone access requires localhost or HTTPS and browser permission.

## Get a Groq API key

1. Open [Groq API Keys](https://console.groq.com/keys).
2. Create a key for your account.
3. Add it as `GROQ_API_KEY` in the backend host environment.
4. Choose a model: `GROQ_MODEL=llama-3.3-70b-versatile` (default) or `llama-3.1-8b-instant`.

Never put it in `frontend/.env`, source code, GitHub, or `VITE_*` variables.

Groq's free developer tier supports conversational models such as `llama-3.3-70b-versatile` and `llama-3.1-8b-instant`. Rate limits and model availability are subject to Groq's current terms. Review [Groq pricing](https://console.groq.com/docs/rate-limits) before public submission.

Default model: `llama-3.3-70b-versatile`. If unavailable to your account, set `GROQ_MODEL` to a currently available model in the Groq console.

## Deploy (recommended: Render + Vercel)

### A. Push the project to GitHub

Create a new GitHub repository, then from the project root:

```bash
git init
git add .
git commit -m "Build Shivani AI voice twin assessment"
git branch -M main
git remote add origin https://github.com/YOUR_USERNAME/shivani-ai-twin.git
git push -u origin main
```

Do not commit `.env` files or API keys. This project includes `.gitignore` for that purpose.

### B. Deploy backend on Render

1. Sign in to [Render](https://render.com/) and choose **New → Web Service**; connect the GitHub repository.
2. Set **Root Directory** to `backend`.
3. Runtime: **Python**.
4. Build command: `pip install -r requirements.txt`.
5. Start command: `uvicorn main:app --host 0.0.0.0 --port $PORT`.
6. Add environment variables:
   - `GROQ_API_KEY` = your Groq API key from https://console.groq.com/keys
   - `GROQ_MODEL` = `llama-3.3-70b-versatile`
   - `ALLOWED_ORIGINS` = `https://YOUR-APP.vercel.app` (after frontend URL is known; temporarily use `*` only while testing)
7. Deploy and open `https://YOUR-SERVICE.onrender.com/health`. Confirm `status` is `healthy` and `configured` is `true`.

### C. Deploy frontend on Vercel

1. Sign in to [Vercel](https://vercel.com/) and import the same GitHub repository.
2. Set **Root Directory** to `frontend` and Framework Preset to **Vite**.
3. Add environment variable `VITE_API_URL` = `https://YOUR-SERVICE.onrender.com` (no trailing slash).
4. Deploy. Open the resulting Vercel URL and test text and microphone flows.
5. Return to Render and set `ALLOWED_ORIGINS` to the exact Vercel production URL, then redeploy the backend.

If Vercel creates a different production domain, update `ALLOWED_ORIGINS` to match it exactly. For preview deployments, add the preview origin only if you want previews to call the API.
### Local deploy script (Vercel CLI)

For a repeatable, no-auth deploy from your own machine, run the included script:

```bash
chmod +x deploy.sh
bash deploy.sh
```

This runs `vercel pull --yes`, builds, and deploys `vercel deploy --prod --yes`.

### Once both hosts are live

1. Open the Vercel frontend URL.
2. Copy its exact domain (e.g., `https://shivani-ai.vercel.app`).
3. Back on Render, update `ALLOWED_ORIGINS` to that exact Vercel domain (no trailing slash).
4. Redeploy the Render backend and confirm `/health` returns `configured: true`.

> Vercel's free plans sleep after inactivity and have usage quotas. The backend on Render may cold-start; both serve a clear loading message during that window.

## Automated tests

### Backend (FastAPI + Pydantic + Groq mocking)

```bash
cd backend
python -m unittest -v
```

Covers: health, profile, suggestions, empty/oversized message rejection, valid chat, missing API key (demo mode), Groq error handling, conversation context preservation, reset, CORS, and secret leakage. Groq calls are mocked, so no paid API requests are made during tests.

### Frontend (Vitest + Testing Library)

```bash
cd frontend
npm ci
npm run build   # TypeScript + Vite production build
npm test        # unit tests
```

Covers: landing page rendering, suggested questions, text send + answer + speak, backend-unavailable error, mic start/stop, simulated voice transcript, conversation reset, voice synthesis availability, and recruiter question cards.

## Manual acceptance checklist

- [ ] Public landing page renders.
- [ ] Text conversation works.
- [ ] Microphone works on supported browsers (HTTPS/localhost).
- [ ] AI speaks its responses (Voice off to disable).
- [ ] The five recruiter questions are answered naturally.
- [ ] Unexpected and follow-up questions are handled with context.
- [ ] Candidate facts are grounded; unknown facts are answered honestly.
- [ ] API key is protected and never entered in the browser.
- [ ] Mobile viewport and browser-without-speech-recognition degrade gracefully.
- [ ] Production build succeeds (`npm run build` and `python -m unittest`).


## Known limitations and responsible disclosure

- Browser speech recognition support varies. Chrome/Edge generally provide the best support; Safari and Firefox support differs by version/device. Text input remains available.
- Speech synthesis uses voices installed by the visitor's operating system/browser. This is not a voice clone of Shivani; it is a browser-generated voice reading her AI twin's answers.
- The public profile intentionally excludes private information. The service does not store chat history in a database; context is sent only for the current request chain.
- Groq free-tier availability, quotas, and data handling are subject to Groq's current terms. Review [Groq pricing](https://console.groq.com/docs/rate-limits) before public submission.
- The included in-memory rate limit is a basic guardrail, not a substitute for a production API gateway/WAF. For a heavily shared public link, add persistent rate limiting and monitoring.
- Do not advertise this as a perfect clone or autonomous agent. It is a profile-grounded conversational voice interface.

## Project layout

```text
shivani-ai-twin/
├── backend/
│   ├── main.py              # FastAPI app + Groq + conversation memory
│   ├── persona.py           # Candidate knowledge base + system prompt
│   ├── requirements.txt
│   ├── test_main.py         # Backend unit tests (16 tests, mocked Groq)
│   ├── .env.example
│   └── .venv/               # Python virtual environment (local)
├── frontend/
│   ├── index.html
│   ├── package.json
│   ├── vite.config.ts
│   └── src/
│       ├── main.tsx
│       ├── App.tsx          # Voice UX + chat UI
│       ├── styles.css
│       ├── vite-env.d.ts
│       ├── App.test.tsx     # Frontend unit tests (8 tests)
│       └── test/
│           └── setup.ts
├── .gitignore
└── README.md
```

## Submission checklist and recruiter email

Before submitting, verify the following:

- [ ] `GET /health` returns `healthy: true` on the public host.
- [ ] Text chat returns a grounded, first-person answer.
- [ ] Follow-up questions keep context (conversation memory works).
- [ ] Microphone input works on a public/HTTPS URL.
- [ ] Spoken responses play in the browser.
- [ ] `npm run build` and `python -m unittest` both pass.
- [ ] The Groq API key is set only in the backend environment, never in code or `VITE_*`.
- [ ] Public URL, deployment health, and CORS are verified.

### Recruiter email

**To:** bhumika@100x.inc
**Subject:** GEN AI: GEN AI ROUND 1 ASSESSMENT (LINKEDIN - SHIVANI BHANDARI)

> Hi Bhumika,
>
> Thank you for the opportunity to participate in the 100x AI Agent Team assessment.
>
> I have completed Stage 1 and built Shivani AI, a personal AI voice twin representing my professional journey, engineering experience, strengths and aspirations.
>
> The application allows anyone to interact with my AI twin through voice or text and ask both predefined and open-ended questions.
>
> **Assessment Demo:** [PUBLIC URL]
>
> **Technology Stack:** React, TypeScript, FastAPI, Groq API and browser-based speech recognition and synthesis.
>
> I have attached my updated resume for your reference.
>
> Looking forward to the next stages of the selection process.
>
> Best regards,
> Shivani Bhandari
> LinkedIn: https://linkedin.com/in/shivaani-bhandari/

### Public submission fields

- **Product name:** Shivani AI
- **Tagline:** Meet my AI twin.
- **Public URL:** (replace `[PUBLIC URL]` with the verified deployed URL)
- **Last tested commit:** `git rev-parse HEAD`
