# Render deployment

Use Docker deployment on Render Free and Neon Free for the database.

## Render settings

- Runtime: Docker
- Dockerfile Path: `./Dockerfile`
- Docker Build Context Directory: `.`
- Health Check Path: `/health`
- Branch: `main`

## Environment variables

```env
NODE_ENV=production
PORT=3000
PUBLIC_BASE_URL=https://YOUR-RENDER-URL.onrender.com
POC_MAX_SESSION_SECONDS=480
LOG_LEVEL=info
AGENT_MODE=local
EDGE_TTS_PYTHON=/usr/bin/python3
DATABASE_URL=postgresql://USER:PASSWORD@HOST.neon.tech/prague_ai_voice?sslmode=require
ADMIN_PASSWORD=change-this-admin-password
```

## Important

Do not use Render Persistent Disk on the free plan. This version stores profile and bookings in Neon PostgreSQL through `DATABASE_URL`.

After pushing changes, use:

```text
Manual Deploy → Clear build cache & deploy
```


## Admin password

Add `ADMIN_PASSWORD` in Render Environment. Use at least 8 characters. This protects admin editor, bookings list, CSV export, backup and demo reset.


## Optional email confirmation

Add these variables only after the basic app and Neon database work:

```env
SMTP_HOST=smtp.example.com
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=your@email.com
SMTP_PASS=your-smtp-password
SMTP_FROM="Prague AI Voice <your@email.com>"
BUSINESS_OWNER_EMAIL=owner@example.com
```

Then redeploy and check `/api/system/status`.


## Public sales URL

After deploy, open:

```text
https://YOUR-RENDER-URL.onrender.com/sales
```
