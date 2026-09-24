-- Briefcast schema, part 3: which episodes are due.
-- Plain SQL so we can test it without Supabase-only extensions.

-- Does this user get an episode on this ISO weekday (1 = Monday … 7 = Sunday)?
create function is_delivery_day(f frequency, custom_days smallint[], iso_dow int) returns boolean
language sql immutable as $$
  select case f
    when 'daily' then true
    when 'weekdays' then iso_dow between 1 and 5
    when 'custom' then iso_dow = any (custom_days)
  end
$$;

-- Can this user get scheduled episodes? Needs an active trial or subscription.
-- (The first episode is free and is created directly at the end of onboarding, not here.)
create function has_access(uid uuid, at_time timestamptz) returns boolean
language sql stable as $$
  select exists (
    select 1 from subscriptions s
    where s.user_id = uid
      and s.status in ('trialing', 'active', 'grace')
      and (s.expires_at is null or s.expires_at > at_time)
  )
$$;

-- Returns every (user, slot) whose delivery time falls between now and now + lead,
-- and that has no episode yet. The slot is computed in the user's own time zone,
-- so daylight saving time is handled by Postgres.
create function due_episode_slots(now_ts timestamptz, lead interval)
returns table (user_id uuid, scheduled_for timestamptz)
language sql stable as $$
  with local_days as (
    -- today and tomorrow in the user's time zone (covers slots just after midnight)
    select ps.user_id, ps.frequency, ps.custom_days, ps.delivery_time, p.time_zone,
           ((now_ts at time zone p.time_zone)::date + d) as local_date
    from podcast_settings ps
    join profiles p on p.user_id = ps.user_id
    cross join (values (0), (1)) as days(d)
    where p.onboarding_done_at is not null
  ), slots as (
    select ld.user_id,
           ((ld.local_date + ld.delivery_time) at time zone ld.time_zone) as scheduled_for,
           extract(isodow from ld.local_date)::int as iso_dow,
           ld.frequency, ld.custom_days
    from local_days ld
  )
  select s.user_id, s.scheduled_for
  from slots s
  where s.scheduled_for > now_ts
    and s.scheduled_for <= now_ts + lead
    and is_delivery_day(s.frequency, s.custom_days, s.iso_dow)
    and has_access(s.user_id, now_ts)
    and not exists (
      select 1 from episodes e where e.user_id = s.user_id and e.scheduled_for = s.scheduled_for
    )
$$;

-- Creates 'queued' episode rows for all due slots and returns them.
-- Settings are copied onto the episode so later changes do not affect a running job.
-- A pending "go deeper" request turns the next episode into a deep dive.
create function create_due_episodes(now_ts timestamptz, lead interval)
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
  left join lateral (
    -- latest "go deeper" tap that has not been used yet
    select sf.segment_id
    from segment_feedback sf
    join feedback f on f.id = sf.feedback_id
    where f.user_id = d.user_id and sf.go_deeper
      and not exists (select 1 from episodes e2 where e2.deep_dive_of_segment_id = sf.segment_id)
    order by f.updated_at desc
    limit 1
  ) dd on true
  on conflict (user_id, scheduled_for) do nothing
  returning *
$$;
