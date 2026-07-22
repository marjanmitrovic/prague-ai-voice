# Public booking page

Version 1.5.0 includes a public customer-facing booking page.

## URL

```text
/booking/studio-aurora
/booking/barber-nova
/booking?business=studio-aurora
```

Example:

```text
https://YOUR-RENDER-URL.onrender.com/booking/studio-aurora
https://YOUR-RENDER-URL.onrender.com/booking/barber-nova
```

## What customers can do

- Select one of the configured businesses.
- See the business name and description.
- See available services with prices and durations.
- Select a service, date, and available time slot.
- Enter name, phone, and an optional note.
- Create a booking request stored in Neon PostgreSQL.

## What remains protected

The public booking page does not expose the admin password or admin editor. These stay protected by `ADMIN_PASSWORD`:

- Admin editor
- Bookings list
- CSV export
- Backup endpoint
- Demo reset endpoint

## Render check

After deploy, open:

```text
https://YOUR-RENDER-URL.onrender.com/booking/studio-aurora/studio-aurora
/booking/barber-nova
/booking?business=studio-aurora
```

Then create a test booking and verify it appears in the admin dashboard after login.
