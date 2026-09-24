-- Briefcast schema, part 4: Supabase platform features (cron, storage).
-- These need Supabase-only extensions, so the local unit tests skip this file.
--
-- Queue design: the `episodes` table itself is the queue. Workers claim rows with
-- claim_next_episode() (FOR UPDATE SKIP LOCKED), so we do not need a separate queue service.

create extension if not exists pg_cron;

-- Every 5 minutes: create 'queued' episodes for users whose delivery time is close.
select cron.schedule('create-due-episodes', '*/5 * * * *',
  $$select count(*) from create_due_episodes(now(), interval '90 minutes')$$);

-- Every 10 minutes: put stuck jobs back in the queue (or mark failed after 3 tries).
select cron.schedule('requeue-stale-episodes', '*/10 * * * *', $$select requeue_stale_episodes()$$);

-- Delete old source text used for fact checks (privacy + copyright hygiene).
select cron.schedule('purge-source-excerpts', '17 3 * * *',
  $$update source_items set body_excerpt = null
    where body_excerpt is not null and created_at < now() - interval '30 days'$$);

-- Storage buckets
insert into storage.buckets (id, name, public) values ('episodes', 'episodes', false) on conflict do nothing;
insert into storage.buckets (id, name, public) values ('voices', 'voices', true) on conflict do nothing;

-- Users can read only their own episode files: path = <user_id>/<episode_id>.mp3
create policy episodes_read_own on storage.objects for select to authenticated
  using (bucket_id = 'episodes' and (storage.foldername(name))[1] = auth.uid()::text);
