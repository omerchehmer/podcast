-- Briefcast schema: shared podcast episode notes.
-- The worker transcribes each episode of a followed podcast once (the feed's transcript, or
-- speech-to-text on the audio) and saves ~800 words of notes. Every listener of that show uses the
-- same row. The full transcript is not stored.

create table episode_transcripts (
  id uuid primary key default gen_random_uuid(),
  source_id uuid not null references sources (id) on delete cascade,
  episode_key text not null,                             -- same as source_items.content_hash
  title text not null,
  audio_url text,
  published_at timestamptz,
  status text not null check (status in ('done', 'failed')),
  origin text check (origin in ('feed', 'speech_to_text')),
  notes text,                                            -- what the writer and checker use
  partial boolean not null default false,                -- notes cover only the first part
  words int not null default 0,                          -- length of the full transcript
  audio_minutes numeric(8, 2) not null default 0,        -- speech-to-text minutes paid for
  cost_usd numeric(10, 4) not null default 0,
  attempts smallint not null default 1,
  error text,                                            -- never contains personal data
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (source_id, episode_key)
);
create index episode_transcripts_recent on episode_transcripts (source_id, published_at desc);
create index episode_transcripts_spend on episode_transcripts (updated_at) where audio_minutes > 0;
alter table episode_transcripts enable row level security; -- no policies: server only
