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
  reported_on   text,
  -- Analyst thumbs up/down from the site; read back as calibration examples
  -- by the AI relevance classifier.
  feedback      text check (feedback in ('up', 'down')),
  feedback_at   timestamptz,
  -- Coverage sentiment TOWARD the 66 Express (not the general tone of the
  -- story). Scored automatically for confirmed/likely items, then overridable
  -- by an analyst on the site. sentiment_source='manual' is permanent: the AI
  -- pass skips those rows forever, so a human call is never silently reverted.
  sentiment        text check (sentiment in ('positive', 'neutral', 'negative')),
  sentiment_source text check (sentiment_source in ('auto', 'manual')),
  sentiment_at     timestamptz
);

-- Migration for pre-existing databases (run once in the SQL editor):
-- alter table public.digest_items
--   add column if not exists feedback text check (feedback in ('up','down')),
--   add column if not exists feedback_at timestamptz;
--
-- Sentiment meter migration (run once in the SQL editor):
-- alter table public.digest_items
--   add column if not exists sentiment text
--     check (sentiment in ('positive','neutral','negative')),
--   add column if not exists sentiment_source text
--     check (sentiment_source in ('auto','manual')),
--   add column if not exists sentiment_at timestamptz;

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

-- Editable monitoring keywords (single row). positive_keywords drive the
-- searches and keep their matches; avoid_phrases suppress noise. Empty arrays
-- fall back to the in-code defaults.
create table if not exists public.monitoring_settings (
  id                smallint primary key default 1,
  positive_keywords text[] not null default '{}',
  avoid_phrases     text[] not null default '{}',
  updated_at        timestamptz not null default now(),
  constraint monitoring_settings_singleton check (id = 1)
);

alter table public.digest_items enable row level security;
alter table public.digest_sends enable row level security;
alter table public.monitoring_settings enable row level security;
