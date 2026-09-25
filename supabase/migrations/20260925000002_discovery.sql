-- Discovery sources fill the gap for users with few sources of their own.
-- Before each episode the worker adds curated sources that match the user's interests, as 'system'
-- sources with lower trust, so the user's own sources still rank first. They show on the Sources
-- screen as "suggested". Removing one mutes it (the row stays), so it is never added again.

-- Add matching discovery sources until the user has fill_up_to active feeds. Returns how many were added.
-- A source is skipped when the user already has it (active or muted), or when it matches an avoided topic.
create function add_discovery_sources(uid uuid, fill_up_to int, system_trust real)
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
    select s.id,
           -- more matching topics first, and "a lot" counts more than "a little"
           sum(case w.user_weight when 'a_lot' then 3 when 'some' then 2 else 1 end) as score
    from sources s
    join wanted w on w.category_id = any (s.discovery_categories) and w.user_weight <> 'avoid'
    where s.is_discovery and s.feed_url is not null
      and not exists (select 1 from user_sources us where us.user_id = uid and us.source_id = s.id)
      and not exists (select 1 from wanted a where a.user_weight = 'avoid' and a.category_id = any (s.discovery_categories))
    group by s.id
    order by score desc, s.id
    limit greatest(0, fill_up_to - (select n from active))
  ),
  added as (
    insert into user_sources (user_id, source_id, added_by, trust)
    select uid, id, 'system', system_trust from picks
    on conflict do nothing
    returning 1
  )
  select count(*)::int from added
$$;

revoke all on function add_discovery_sources(uuid, int, real) from public, authenticated, anon;
grant execute on function add_discovery_sources(uuid, int, real) to service_role;
