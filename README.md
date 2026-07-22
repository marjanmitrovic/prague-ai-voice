# Prague AI Voice

**Verze 1.9.0 — Final Demo Polish.** České demo pro prodej prvním klientům: landing page, veřejné rezervace, správa klientů, onboarding, admin login, Neon PostgreSQL a email potvrzení.

Persistent demo of a Czech AI voice receptionist for small businesses. The demo runs in the browser, stores profile and booking data in Neon PostgreSQL, supports booking requests, and speaks Czech with a neural TTS voice.

![Dashboard mockup](assets/dashboard-mockup.png)

## What it does

- Provides public booking pages at `/booking/studio-aurora` and `/booking/barber-nova`.
- Supports multiple businesses in one Render service and one Neon database.

- Answers basic customer questions from an editable business profile.
- Speaks Czech with `edge-tts` neural voices.
- Creates booking requests.
- Stores business profile and bookings in Neon PostgreSQL via `DATABASE_URL`.
- Checks opening hours, service duration, closed dates, and booking conflicts.
- Supports a natural Czech booking sentence.
- Exports bookings to CSV.
- Runs without Twilio, Supabase, or OpenAI API billing.

## Tech stack

- Node.js 20+
- TypeScript
- Fastify
- PostgreSQL / Neon
- Local JSON seed fallback for development
- `edge-tts` via Python for Czech neural speech

## Quick start on Windows

```powershell
Copy-Item .env.example .env
npm install
npm test
npm run build
npm run dev
```

Open:

```text
http://127.0.0.1:3000
```

Locally, if `DATABASE_URL` is not set, the app uses in-memory demo storage seeded from `data/business-profile.json` and `data/bookings.json`. On Render, set `DATABASE_URL` from Neon.

## Czech neural voice setup

Install Python and `edge-tts`:

```powershell
py -m pip install --user edge-tts
```

Test the Czech female voice:

```powershell
py -m edge_tts --voice cs-CZ-VlastaNeural --text "Dobrý den, jak vám mohu pomoci?" --write-media test-vlasta.mp3
start test-vlasta.mp3
```

## Environment

```env
NODE_ENV=development
PORT=3000
PUBLIC_BASE_URL=http://127.0.0.1:3000
POC_MAX_SESSION_SECONDS=480
PROMPT_VERSION=studio-aurora-local-v1
LOG_LEVEL=info
AGENT_MODE=local
EDGE_TTS_PYTHON=
DATABASE_URL=postgresql://USER:PASSWORD@HOST.neon.tech/prague_ai_voice?sslmode=require
```

## Useful endpoints

```text
GET  /health
GET  /api/system/status
GET  /api/system/backup.json
POST /api/system/demo-reset
GET  /api/businesses
GET  /api/business-profile
PUT  /api/business-profile
GET  /api/bookings
GET  /api/bookings/export.csv
GET  /api/bookings/availability
GET  /api/bookings/slots
POST /api/bookings
POST /api/assistant/text
POST /api/assistant/booking-conversation
GET  /api/tts/status
POST /api/tts/czech
```

## Klientský onboarding

Chráněná stránka pro založení nové firmy bez ruční úpravy databáze:

```text
/onboarding
/admin/onboarding
```

Používá stejné `ADMIN_PASSWORD` jako administrace. Po uložení vznikne veřejný odkaz:

```text
/booking/<business-slug>
```

Podrobnosti: [`docs/CLIENT_ONBOARDING.md`](docs/CLIENT_ONBOARDING.md).

## Hlavní odkazy

```text
/sales
/booking/studio-aurora
/booking/barber-nova
/admin/clients
/admin/onboarding
```

## Deployment

For Render + Neon deployment, see:

```text
docs/DEPLOY_RENDER.md
docs/NEON_SETUP.md
docs/MULTI_BUSINESS.md
```

## Current limitations

This is a demo, not a complete production phone system.

- No real phone number.
- No authentication.
- No GDPR-ready production workflow.
- No paid AI API integration.
- Rule-based local agent.


## Admin login

Set `ADMIN_PASSWORD` in Render Environment. The browser sends it as `x-admin-password` for protected admin actions.

Protected actions:

```text
PUT  /api/business-profile
POST /api/business-profile/reload
GET  /api/bookings
GET  /api/bookings/export.csv
GET  /api/system/backup.json
POST /api/system/demo-reset
```

Public actions remain open for the demo assistant and booking flow.

## Email confirmation

See [`docs/EMAIL_CONFIRMATION.md`](docs/EMAIL_CONFIRMATION.md).

## Multi-business demo

See [`docs/MULTI_BUSINESS.md`](docs/MULTI_BUSINESS.md).

Public booking links:

```text
/booking/studio-aurora
/booking/barber-nova
```
