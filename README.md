# 66 Media Monitor

Private media-monitoring dashboard and daily digest system for 66 Outside the Beltway / 66 EMP / 66 Express Lanes coverage.

## What This Does

- Tracks priority media sources, broadcast outlets, and public social/search-visible sources.
- Labels coverage as confirmed, likely, uncertain, or noise.
- Uses free public collection paths first: GDELT, Google News RSS-style searches, and public Reddit search.
- Sends a 6:30 AM Eastern weekday digest.
- Sends weekend email only when a critical/breaking threshold is met.
- Keeps uncertain items at the bottom of the digest.

## Setup

Create these environment variables in Vercel:

- `APP_BASE_URL`
- `CRON_SECRET`
- `EMAIL_FROM`
- `EMAIL_TO`
- `RESEND_API_KEY`
- `TIMEZONE`
- `SUPABASE_URL` (optional)
- `SUPABASE_SERVICE_ROLE_KEY` (optional)

The app can build and run without live credentials. Email sending requires the
Resend variables; persistence requires the Supabase variables.

## Persistence (optional)

Persistence is powered by Supabase and is fully optional — without it the app
still collects live and emails, just without dedup, idempotency, or history.

To enable it:

1. Create a Supabase project.
2. Run [`supabase/schema.sql`](supabase/schema.sql) in the Supabase SQL editor.
3. Set `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` in Vercel.

What it adds:

- **Cross-day dedup** — an article already emailed in a previous digest is not
  repeated, except `important`/critical items, which always appear.
- **Once-per-day idempotency** — `digest_sends` records each day's send, so a
  second cron invocation in the same window does not double-send.
- **History** — the dashboard and digest preview read the last stored snapshot
  instead of running a live external fetch on every page load. Live collection
  only happens in the cron job.

## Access control

The whole site is behind a shared HTTP Basic Auth login (handled in
`src/middleware.ts`). Set both env vars in Vercel to enable it:

- `BASIC_AUTH_USER`
- `BASIC_AUTH_PASSWORD`

If either is unset the gate is disabled, so a missing variable can't lock
everyone out. The cron endpoint (`/api/cron/daily-digest`) is excluded from the
gate because Vercel's scheduler authenticates with `CRON_SECRET` instead.

## Development

```bash
npm install
npm run dev
```

## Cron

Vercel calls `/api/cron/daily-digest` at 10:30 and 11:30 UTC. Across DST exactly
one of those lands in the 6 AM Eastern hour, and the route sends for any time in
that hour (tolerant of Vercel's cron drift, which previously could skip a day
when an invocation missed an exact-minute check). When Supabase is configured,
the `digest_sends` table provides durable once-per-day protection so drift into
the hour from both crons cannot double-send.
