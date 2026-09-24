-- Briefcast schema, part 1: tables.
-- Every user table points to auth.users with ON DELETE CASCADE,
-- so deleting the auth user deletes all of that user's data (App Store requirement).

-- ---------- Enums ----------
create type frequency as enum ('weekdays', 'daily', 'custom');
create type episode_format as enum ('solo', 'conversation');
create type episode_type as enum ('mix', 'deep_dive');
create type tone as enum ('direct', 'calm');
create type interest_weight as enum ('a_lot', 'some', 'a_little', 'avoid');
create type source_kind as enum ('podcast', 'rss', 'website', 'newsletter_email', 'youtube', 'book');
create type added_by as enum ('user', 'system');
create type context_origin as enum ('paste', 'mcp', 'manual');
create type episode_status as enum (
  'queued', 'collecting', 'ranking', 'planning', 'writing', 'checking', 'voicing', 'ready', 'failed'
);
create type episode_trigger as enum ('schedule', 'first', 'deep_dive_request', 'manual');
create type segment_kind as enum ('intro', 'idea', 'recap', 'questions');
create type listen_event as enum ('start', 'progress', 'complete', 'chapter_jump', 'speed_change');
create type report_reason as enum ('wrong_fact', 'harmful', 'other');
create type report_status as enum ('open', 'reviewed', 'closed');
create type subscription_status as enum ('trialing', 'active', 'grace', 'expired', 'cancelled');

-- Keeps updated_at fresh on every update.
create function set_updated_at() returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

-- ---------- Users and settings ----------
create table profiles (
  user_id uuid primary key references auth.users (id) on delete cascade,
  display_name text,
  time_zone text not null default 'UTC',
  app_language text not null default 'en',
  onboarding_done_at timestamptz,
  ai_disclosure_seen_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table podcast_settings (
  user_id uuid primary key references auth.users (id) on delete cascade,
  frequency frequency not null default 'weekdays',
  custom_days smallint[] not null default '{}',          -- 1 = Monday … 7 = Sunday
  delivery_time time not null default '07:30',           -- local time
  length_minutes smallint not null default 15 check (length_minutes between 5 and 30),
  format episode_format not null default 'solo',
  voice_a_id text not null default 'marin',
  voice_b_id text not null default 'cedar',
  episode_type episode_type not null default 'mix',
  tone tone not null default 'direct',
  episode_language text not null default 'en',
  auto_download_wifi boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- The listener profile ("what the app knows about you").
-- The text is encrypted by the server (AES-256-GCM) before it is stored. The key is not in the database.
create table listener_context (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  ciphertext bytea not null,
  key_version smallint not null default 1,
  origin context_origin not null,
  removed_items jsonb not null default '[]',             -- types removed by the scrubber, never the data
  is_current boolean not null default true,
  created_at timestamptz not null default now()
);
create unique index listener_context_one_current on listener_context (user_id) where is_current;

-- ---------- Interests and sources ----------
create table topic_categories (
  id text primary key,                                   -- short slug, e.g. 'ai'
  name text not null,
  parent_id text references topic_categories (id),
  sort smallint not null default 0
);

create table interests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  category_id text references topic_categories (id),     -- null for free-text topics
  label text not null,
  user_weight interest_weight not null default 'some',
  learned_weight real not null default 1 check (learned_weight between 0 and 2),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, label)
);

-- Shared catalog: one row per real feed, so each feed is fetched once for all users.
create table sources (
  id uuid primary key default gen_random_uuid(),
  kind source_kind not null,
  title text not null,
  url text,
  feed_url text,
  image_url text,
  external_id text,                                      -- Podcast Index ID, Apple ID, ISBN
  is_discovery boolean not null default false,           -- part of our curated list
  discovery_categories text[] not null default '{}',
  owner_user_id uuid references auth.users (id) on delete cascade, -- set for private sources (newsletter inbox)
  last_fetched_at timestamptz,
  fetch_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index sources_feed_url_unique on sources (feed_url) where feed_url is not null and owner_user_id is null;

create table user_sources (
  user_id uuid not null references auth.users (id) on delete cascade,
  source_id uuid not null references sources (id) on delete cascade,
  added_by added_by not null default 'user',
  trust real not null default 1 check (trust between 0 and 1),
  muted boolean not null default false,
  created_at timestamptz not null default now(),
  primary key (user_id, source_id)
);

create table inbound_addresses (
  user_id uuid primary key references auth.users (id) on delete cascade,
  address text not null unique,                          -- e.g. omer-7k3p@in.briefcast.app
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table source_items (
  id uuid primary key default gen_random_uuid(),
  source_id uuid not null references sources (id) on delete cascade,
  owner_user_id uuid references auth.users (id) on delete cascade, -- private items (forwarded newsletters)
  title text not null,
  url text,
  author text,
  published_at timestamptz,
  summary text,                                          -- short summary from the feed or ours
  body_excerpt text,                                     -- cleaned text for fact checks; deleted after 30 days
  content_hash text not null,
  created_at timestamptz not null default now()
);
create unique index source_items_dedupe on source_items (source_id, content_hash);
create index source_items_recent on source_items (source_id, published_at desc);

-- ---------- Episodes ----------
create table episodes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  status episode_status not null default 'queued',
  scheduled_for timestamptz not null,
  trigger episode_trigger not null default 'schedule',
  deep_dive_of_segment_id uuid,                          -- FK added below (segments table comes later)
  episode_type episode_type not null,
  format episode_format not null,
  tone tone not null,
  language text not null default 'en',
  target_seconds int not null,
  actual_seconds int,
  title text,
  summary text,
  change_note text,                                      -- "More leadership, fewer market updates, as you asked."
  audio_path text,                                       -- storage path in the 'episodes' bucket
  transcript jsonb,                                      -- [{speaker, text, start, end}]
  plan jsonb,                                            -- saved for retries and debugging
  cost_usd numeric(10, 4) not null default 0,
  attempts smallint not null default 0,
  error text,                                            -- never contains personal data
  published_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, scheduled_for)                        -- stops double episodes for the same slot
);
create index episodes_user_recent on episodes (user_id, scheduled_for desc);

create table episode_segments (
  id uuid primary key default gen_random_uuid(),
  episode_id uuid not null references episodes (id) on delete cascade,
  idx smallint not null,
  kind segment_kind not null,
  title text not null,
  main_idea text,
  question text,
  topic_tags text[] not null default '{}',
  start_sec real,
  end_sec real,
  unique (episode_id, idx)
);

alter table episodes
  add constraint episodes_deep_dive_fk
  foreign key (deep_dive_of_segment_id) references episode_segments (id) on delete set null;

create table episode_sources (
  episode_id uuid not null references episodes (id) on delete cascade,
  segment_id uuid references episode_segments (id) on delete cascade,
  source_item_id uuid not null references source_items (id) on delete cascade,
  short_quote text check (short_quote is null or array_length(regexp_split_to_array(short_quote, '\s+'), 1) <= 25),
  primary key (episode_id, source_item_id)
);

create table cost_log (
  id bigint generated always as identity primary key,
  episode_id uuid references episodes (id) on delete cascade,
  step text not null,
  provider text not null,
  model text not null,
  input_tokens int not null default 0,
  output_tokens int not null default 0,
  cache_read_tokens int not null default 0,
  characters int not null default 0,
  usd numeric(10, 5) not null,
  created_at timestamptz not null default now()
);

-- ---------- Feedback and learning ----------
create table feedback (
  id uuid primary key default gen_random_uuid(),
  episode_id uuid not null references episodes (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  stars smallint check (stars between 1 and 5),
  quick_tags text[] not null default '{}',
  note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (episode_id, user_id)
);

create table segment_feedback (
  feedback_id uuid not null references feedback (id) on delete cascade,
  segment_id uuid not null references episode_segments (id) on delete cascade,
  thumb smallint check (thumb in (-1, 1)),
  go_deeper boolean not null default false,
  primary key (feedback_id, segment_id)
);

create table preference_state (
  user_id uuid primary key references auth.users (id) on delete cascade,
  depth real not null default 0,
  news_vs_ideas real not null default 0.3,
  work_relevance real not null default 0.7,
  length_bias_seconds int not null default 0,
  planner_summary text not null default '',
  last_change_note text not null default '',
  updated_at timestamptz not null default now()
);

-- ---------- Other ----------
create table voices (
  id text primary key,
  provider text not null,
  provider_voice_id text not null,
  name text not null,
  description text,
  languages text[] not null default '{en}',
  preview_path text,
  words_per_minute real not null default 160,
  active boolean not null default true
);

create table listen_events (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  episode_id uuid not null references episodes (id) on delete cascade,
  event listen_event not null,
  position_sec real,
  at timestamptz not null default now()
);
create index listen_events_episode on listen_events (episode_id, at);

create table episode_reports (
  id uuid primary key default gen_random_uuid(),
  episode_id uuid not null references episodes (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  reason report_reason not null,
  note text,
  status report_status not null default 'open',
  created_at timestamptz not null default now()
);

-- Written only by the RevenueCat webhook (service role).
create table subscriptions (
  user_id uuid primary key references auth.users (id) on delete cascade,
  rc_app_user_id text not null,
  entitlement text not null default 'pro',
  status subscription_status not null,
  period text,                                           -- 'monthly' | 'yearly'
  trial_ends_at timestamptz,
  expires_at timestamptz,
  updated_at timestamptz not null default now()
);

create table push_tokens (
  user_id uuid not null references auth.users (id) on delete cascade,
  expo_token text not null,
  platform text not null default 'ios',
  created_at timestamptz not null default now(),
  primary key (user_id, expo_token)
);

-- Assistants connected through the MCP server (OAuth).
create table mcp_grants (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  client_name text not null,
  scopes text[] not null default '{}',
  token_hash text not null unique,                       -- we store only a hash of the token
  last_used_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz not null default now()
);

-- updated_at triggers
create trigger t_profiles_updated before update on profiles for each row execute function set_updated_at();
create trigger t_settings_updated before update on podcast_settings for each row execute function set_updated_at();
create trigger t_interests_updated before update on interests for each row execute function set_updated_at();
create trigger t_sources_updated before update on sources for each row execute function set_updated_at();
create trigger t_episodes_updated before update on episodes for each row execute function set_updated_at();
create trigger t_feedback_updated before update on feedback for each row execute function set_updated_at();
create trigger t_pref_updated before update on preference_state for each row execute function set_updated_at();
create trigger t_subs_updated before update on subscriptions for each row execute function set_updated_at();
