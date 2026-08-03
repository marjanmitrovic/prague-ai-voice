# Multi-business demo

Version 1.5.0 can serve more than one business from one Render service and one Neon PostgreSQL database.

## Public booking links

Default salon:

```text
/booking/studio-aurora
```

Second demo business:

```text
/booking/barber-nova
```

The booking page also supports query parameters:

```text
/booking?business=studio-aurora
/booking?business=barber-nova
```

## API

List businesses:

```text
GET /api/businesses
```

Read one public profile:

```text
GET /api/business-profile?businessSlug=studio-aurora
```

Slots for one business:

```text
GET /api/bookings/slots?businessSlug=studio-aurora&serviceName=...&date=2099-08-15
```

Create public booking:

```json
{
  "businessSlug": "studio-aurora",
  "serviceName": "Základní kosmetické ošetření",
  "customerName": "Jan Novák",
  "customerPhone": "+420111222333",
  "customerEmail": "jan@example.com",
  "date": "2099-08-15",
  "time": "10:00"
}
```

## Admin

Admin routes remain protected by `ADMIN_PASSWORD`.

Use `businessSlug` in admin calls to work with one business at a time.

```text
GET /api/bookings?businessSlug=barber-nova
GET /api/bookings/export.csv?businessSlug=barber-nova
GET /api/system/backup.json?businessSlug=barber-nova
POST /api/system/demo-reset?businessSlug=barber-nova
```

## Database migration

The app creates a new table:

```text
business_profiles
```

and adds:

```text
bookings.business_slug
```

Existing bookings are kept under the default slug:

```text
studio-aurora
```
