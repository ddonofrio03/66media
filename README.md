# 66 Media Monitor

Private media-monitoring dashboard and daily digest system for 66 Outside the Beltway / 66 EMP / 66 Express Lanes coverage.

## What This Does

- Tracks priority media sources, broadcast outlets, and public social/search-visible sources.
- Labels coverage as confirmed, likely, uncertain, related, or noise.
- Sends a 6:30 AM Eastern weekday digest.
- Sends weekend email only when a critical/breaking threshold is met.
- Keeps uncertain items at the bottom of the digest.

## Setup

Create these environment variables in Vercel:

- `APP_BASE_URL`
- `CRON_SECRET`
- `DATABASE_URL`
- `EMAIL_FROM`
- `EMAIL_TO`
- `RESEND_API_KEY`
- `TIMEZONE`

The app can build without live credentials. Email sending and future database persistence require the Vercel environment variables above.

## Development

```bash
npm install
npm run dev
```

## Cron

Vercel calls `/api/cron/daily-digest` at 10:30 and 11:30 UTC. The route checks New York local time and sends only when it is 6:30 AM Eastern. Supabase-backed send history will add durable once-per-day protection in the next setup pass.
