# PostgreSQL persistent storage

Version 1.1.1 stores the business profile and bookings in PostgreSQL through `DATABASE_URL`.

For Render Free, use Neon Free PostgreSQL.

## Local development

Without `DATABASE_URL`, the app uses in-memory demo storage seeded from:

```text
data/business-profile.json
data/bookings.json
```

## Production / Render

Set:

```env
DATABASE_URL=postgresql://USER:PASSWORD@HOST.neon.tech/prague_ai_voice?sslmode=require
```

Tables are created automatically on first startup:

```text
business_profile
bookings
app_meta
```

## Backup

Use:

```text
GET /api/system/backup.json
```

## Demo reset

Use:

```text
POST /api/system/demo-reset
```
