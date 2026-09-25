-- Briefcast schema, part 5: why we picked each catalog source.
-- The catalog (seed.sql) is researched per topic. Each source shows the listener a short reason
-- and the proof behind it (awards, ratings, who recommends it), with links.

alter table sources
  add column if not exists why text,                                   -- one or two short sentences, simple English
  add column if not exists evidence jsonb not null default '[]',       -- [{label, url}], 1–3 items
  add column if not exists discovery_trust real not null default 0.8   -- our quality score, 0–1; used to rank suggestions
    check (discovery_trust between 0 and 1);

-- Deep male voice with an inspiring style (style text lives in packages/shared/src/config/ai.ts).
insert into voices (id, provider, provider_voice_id, name, description, preview_path, words_per_minute) values
  ('onyx', 'openai', 'onyx', 'Onyx', 'Deep and inspiring', 'voices/onyx.mp3', 175)
on conflict (id) do nothing;
