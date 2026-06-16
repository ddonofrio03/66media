-- 66 Media Monitor — Supabase schema
-- Run this once in the Supabase SQL editor for the project, then set
-- SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in Vercel.
--
-- These tables are written only by the server (service-role key) from the cron
-- job. RLS is enabled with no public policies, so the anon/public key cannot
-- read or write them.

-- Every relevant item we have ever surfaced. Used for cross-day dedup so the
-- email does not repeat an article it already reported.
create table if not exists public.digest_items (
  id            text primary key,            -- stable id (normalized url, else title)
  title         text not null,
  url           text not null,
  source        text not null,
  source_type   text not null,
  label         text not null,
  priority      text not null,
  reason        text,
  snippet       text,
  published_at  timestamptz,
  first_seen_at timestamptz not null default now(),
  last_seen_at  timestamptz not null default now(),
  -- the local (Eastern) date_key of the digest that first emailed this item,
  -- null until it actually goes out in a sent digest.
  reported_on   text
);

create index if not exists digest_items_reported_on_idx on public.digest_items (reported_on);

-- One row per calendar day a digest was sent. Provides once-per-day
-- idempotency and a history feed for the dashboard.
create table if not exists public.digest_sends (
  date_key             text primary key,     -- e.g. 2026-06-16 in America/New_York
  sent_at              timestamptz not null default now(),
  is_weekend           boolean not null default false,
  no_relevant_coverage boolean not null default false,
  total_items          integer not null default 0,
  important_count      integer not null default 0,
  new_items            integer not null default 0,
  degraded_providers   text[] not null default '{}',
  recipients           text[] not null default '{}',
  snapshot             jsonb                 -- full rendered DigestSnapshot for history
);

create index if not exists digest_sends_sent_at_idx on public.digest_sends (sent_at desc);

alter table public.digest_items enable row level security;
alter table public.digest_sends enable row level security;
