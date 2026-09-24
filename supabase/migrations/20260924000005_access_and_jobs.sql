-- Briefcast schema, part 5: invite codes, test-user access, on-demand episodes, job claiming.

-- Friends-and-family / beta testers get full access without a subscription.
alter table profiles add column access_override boolean not null default false;

create or replace function has_access(uid uuid, at_time timestamptz) returns boolean
language sql stable as $$
  select exists (select 1 from profiles p where p.user_id = uid and p.access_override)
      or exists (
        select 1 from subscriptions s
        where s.user_id = uid
          and s.status in ('trialing', 'active', 'grace')
          and (s.expires_at is null or s.expires_at > at_time)
      )
$$;

-- Invite codes for the demo. No RLS policy: only redeem_invite() and the service role touch it.
create table invite_codes (
  code text primary key,
  note text,                                   -- who it is for, e.g. 'friends batch 1'
  max_uses int not null default 1,
  uses int not null default 0,
  created_at timestamptz not null default now()
);
alter table invite_codes enable row level security;

-- Called by a signed-in user. Gives access if the code is valid. Codes are not case sensitive.
create function redeem_invite(invite text) returns boolean
language plpgsql security definer set search_path = public as $$
declare
  uid uuid := auth.uid();
begin
  if uid is null then return false; end if;
  if exists (select 1 from profiles where user_id = uid and access_override) then return true; end if;
  update invite_codes set uses = uses + 1
    where code = upper(trim(invite)) and uses < max_uses;
  if not found then return false; end if;
  update profiles set access_override = true where user_id = uid;
  return true;
end $$;
revoke all on function redeem_invite(text) from public;
grant execute on function redeem_invite(text) to authenticated;

-- The latest "go deeper" tap that has not been used for an episode yet.
create function pending_deep_dive(uid uuid) returns uuid
language sql stable as $$
  select sf.segment_id
  from segment_feedback sf
  join feedback f on f.id = sf.feedback_id
  where f.user_id = uid and sf.go_deeper
    and not exists (select 1 from episodes e where e.deep_dive_of_segment_id = sf.segment_id)
  order by f.updated_at desc
  limit 1
$$;

-- "Make an episode now". The first episode is free for everyone; more need access.
-- Limits: one job at a time, and at most 3 on-demand episodes per day.
create function request_episode_now() returns uuid
language plpgsql security definer set search_path = public as $$
declare
  uid uuid := auth.uid();
  is_first boolean;
  dd uuid;
  ps podcast_settings;
  pr preference_state;
  new_id uuid;
begin
  if uid is null then raise exception 'not signed in'; end if;
  select not exists (select 1 from episodes where user_id = uid) into is_first;
  if exists (select 1 from episodes where user_id = uid and status not in ('ready', 'failed')) then
    raise exception 'an episode is already being made';
  end if;
  if not is_first and not has_access(uid, now()) then raise exception 'no access'; end if;
  if (select count(*) from episodes where user_id = uid and trigger in ('first', 'manual', 'deep_dive_request')
        and created_at > now() - interval '1 day') >= 3 then
    raise exception 'daily limit reached';
  end if;

  select * into ps from podcast_settings where user_id = uid;
  select * into pr from preference_state where user_id = uid;
  dd := pending_deep_dive(uid);

  insert into episodes (user_id, scheduled_for, trigger, episode_type, format, tone, language, target_seconds, deep_dive_of_segment_id)
  values (uid, now(),
          case when is_first then 'first' when dd is not null then 'deep_dive_request' else 'manual' end::episode_trigger,
          case when dd is not null then 'deep_dive' else ps.episode_type end,
          ps.format, ps.tone, ps.episode_language,
          ps.length_minutes * 60 + coalesce(pr.length_bias_seconds, 0), dd)
  returning id into new_id;
  return new_id;
end $$;
revoke all on function request_episode_now() from public;
grant execute on function request_episode_now() to authenticated;

-- Add a feed or a book for the signed-in user. Public feeds are shared in the catalog;
-- books are private to the user. The worker checks feeds when it fetches them.
create function add_source(kind source_kind, title text, url text default null, feed_url text default null)
returns uuid
language plpgsql security definer set search_path = public as $$
declare
  uid uuid := auth.uid();
  sid uuid;
begin
  if uid is null then raise exception 'not signed in'; end if;
  if kind = 'book' then
    insert into sources (kind, title, owner_user_id) values ('book', left(title, 200), uid) returning id into sid;
  else
    if feed_url is null or feed_url !~* '^https?://' then raise exception 'feed_url must be an http(s) URL'; end if;
    select id into sid from sources s where s.feed_url = add_source.feed_url and s.owner_user_id is null;
    if sid is null then
      insert into sources (kind, title, url, feed_url) values (kind, left(title, 200), url, add_source.feed_url) returning id into sid;
    end if;
  end if;
  insert into user_sources (user_id, source_id, added_by) values (uid, sid, 'user') on conflict do nothing;
  return sid;
end $$;
revoke all on function add_source(source_kind, text, text, text) from public;
grant execute on function add_source(source_kind, text, text, text) to authenticated;

-- ---------- Worker side (service role only) ----------

-- Take the next queued episode. Safe with many workers at once.
create function claim_next_episode() returns setof episodes
language sql volatile as $$
  update episodes set status = 'collecting', attempts = attempts + 1
  where id = (
    select id from episodes
    where status = 'queued' and scheduled_for <= now() + interval '3 hours'
    order by scheduled_for
    limit 1
    for update skip locked
  )
  returning *
$$;

-- Jobs stuck in a working state for 30 minutes go back to the queue, or fail after 3 tries.
create function requeue_stale_episodes() returns int
language sql volatile as $$
  with stale as (
    update episodes
    set status = case when attempts >= 3 then 'failed'::episode_status else 'queued'::episode_status end,
        error = coalesce(error, 'timed out')
    where status in ('collecting', 'ranking', 'planning', 'writing', 'checking', 'voicing')
      and updated_at < now() - interval '30 minutes'
    returning 1
  )
  select count(*)::int from stale
$$;

revoke all on function claim_next_episode() from public, authenticated, anon;
revoke all on function requeue_stale_episodes() from public, authenticated, anon;
revoke all on function create_due_episodes(timestamptz, interval) from public, authenticated, anon;

-- Same as in part 3, but uses the shared pending_deep_dive() helper.
create or replace function create_due_episodes(now_ts timestamptz, lead interval)
returns setof episodes
language sql volatile as $$
  insert into episodes (user_id, scheduled_for, trigger, episode_type, format, tone, language, target_seconds,
                        deep_dive_of_segment_id)
  select d.user_id, d.scheduled_for,
         case when dd.segment_id is not null then 'deep_dive_request'::episode_trigger else 'schedule'::episode_trigger end,
         case when dd.segment_id is not null then 'deep_dive'::episode_type else ps.episode_type end,
         ps.format, ps.tone, ps.episode_language,
         ps.length_minutes * 60 + coalesce(pr.length_bias_seconds, 0),
         dd.segment_id
  from due_episode_slots(now_ts, lead) d
  join podcast_settings ps on ps.user_id = d.user_id
  left join preference_state pr on pr.user_id = d.user_id
  cross join lateral (select pending_deep_dive(d.user_id) as segment_id) dd
  on conflict (user_id, scheduled_for) do nothing
  returning *
$$;

grant execute on function claim_next_episode() to service_role;
grant execute on function requeue_stale_episodes() to service_role;
grant execute on function create_due_episodes(timestamptz, interval) to service_role;
