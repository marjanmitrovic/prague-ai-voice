# Neon PostgreSQL setup

Use this for Render Free, because Render Free does not support Persistent Disk.

## 1. Create Neon project

- Project name: `prague-ai-voice`
- Region: Europe if available
- Database name: `prague_ai_voice`

## 2. Copy connection string

Use the pooled or direct connection string with SSL:

```text
postgresql://USER:PASSWORD@HOST.neon.tech/prague_ai_voice?sslmode=require
```

## 3. Add to Render

Render → your service → Environment → Add Environment Variable:

```env
DATABASE_URL=postgresql://USER:PASSWORD@HOST.neon.tech/prague_ai_voice?sslmode=require
ADMIN_PASSWORD=change-this-admin-password
```

Do not paste this value into GitHub.

## 4. Deploy

Use:

```text
Manual Deploy → Clear build cache & deploy
```

The app creates tables automatically on first startup.


## Admin password

Add `ADMIN_PASSWORD` in Render Environment. Use at least 8 characters. This protects admin editor, bookings list, CSV export, backup and demo reset.
