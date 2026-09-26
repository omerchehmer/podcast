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

-- Suggestions added by the worker: best match first, then our quality score.
-- Same as 20260925000002, plus ordering by discovery_trust, and the added row starts at that trust (capped).
create or replace function add_discovery_sources(uid uuid, fill_up_to int, system_trust real)
returns int
language sql volatile as $$
  with active as (
    select count(*)::int as n
    from user_sources us join sources s on s.id = us.source_id
    where us.user_id = uid and not us.muted and s.kind <> 'book'
  ),
  wanted as (
    select category_id, user_weight from interests
    where user_id = uid and category_id is not null
  ),
  picks as (
    select s.id, max(s.discovery_trust) as quality,
           sum(case w.user_weight when 'a_lot' then 3 when 'some' then 2 else 1 end) as score
    from sources s
    join wanted w on w.category_id = any (s.discovery_categories) and w.user_weight <> 'avoid'
    where s.is_discovery and s.feed_url is not null
      and not exists (select 1 from user_sources us where us.user_id = uid and us.source_id = s.id)
      and not exists (select 1 from wanted a where a.user_weight = 'avoid' and a.category_id = any (s.discovery_categories))
    group by s.id
    order by score desc, quality desc, s.id
    limit greatest(0, fill_up_to - (select n from active))
  ),
  added as (
    insert into user_sources (user_id, source_id, added_by, trust)
    select uid, id, 'system', least(system_trust, quality) from picks
    on conflict do nothing
    returning 1
  )
  select count(*)::int from added
$$;
revoke all on function add_discovery_sources(uuid, int, real) from public, authenticated, anon;
grant execute on function add_discovery_sources(uuid, int, real) to service_role;
