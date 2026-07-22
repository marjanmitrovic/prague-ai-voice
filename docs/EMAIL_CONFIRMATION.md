# Email confirmation

Version `1.4.0` can send automatic booking confirmation emails.

Email is optional. If SMTP variables are empty, bookings still work and are saved to Neon/PostgreSQL.

## Render environment variables

Add these only when you want email confirmation:

```env
SMTP_HOST=smtp.example.com
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=your@email.com
SMTP_PASS=your-smtp-password
SMTP_FROM="Prague AI Voice <your@email.com>"
BUSINESS_OWNER_EMAIL=owner@example.com
```

## Gmail option

For Gmail, use an App Password, not your normal Google account password.

Typical Gmail settings:

```env
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=yourgmail@gmail.com
SMTP_PASS=your-google-app-password
SMTP_FROM="Prague AI Voice <yourgmail@gmail.com>"
BUSINESS_OWNER_EMAIL=owner@example.com
```

## Who receives email

- `BUSINESS_OWNER_EMAIL` receives every new booking.
- Customer receives confirmation only when the booking form includes `customerEmail`.

## Status check

Open:

```text
/api/system/status
```

Look for:

```json
"emailConfigured": true
```

If `emailConfigured` is false, bookings still work but no email is sent.
