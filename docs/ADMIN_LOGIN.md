# Admin login

Version 1.2.0 protects admin actions with `ADMIN_PASSWORD`.

## Render Environment

Add:

```env
ADMIN_PASSWORD=change-this-admin-password
```

Use a stronger password before sharing the public URL.

## Protected endpoints

```text
PUT  /api/business-profile
POST /api/business-profile/reload
GET  /api/bookings
GET  /api/bookings/export.csv
GET  /api/system/backup.json
POST /api/system/demo-reset
```

## Public endpoints

The demo assistant and public booking creation stay open:

```text
GET  /api/business-profile
GET  /api/bookings/availability
GET  /api/bookings/slots
POST /api/bookings
POST /api/assistant/text
POST /api/assistant/booking-conversation
POST /api/tts/czech
```

## Browser usage

Open the Admin editor or Reservations page, enter the same `ADMIN_PASSWORD`, and click the unlock button. The password is stored only in `sessionStorage` for that browser tab/session.

## API usage

Send the password as a header:

```text
x-admin-password: your-password
```

Bearer auth also works:

```text
Authorization: Bearer your-password
```
