-- Briefcast schema, part 4: Supabase platform features (queue, cron, storage).
-- These need Supabase extensions, so the local unit tests skip this file.

create extension if not exists pgmq;
create extension if not exists pg_cron;

-- Episode jobs queue. The worker reads from it; failed jobs become visible again after a timeout.
select pgmq.create('episode_jobs');

-- Every 5 minutes: create due episodes and put one job per episode on the queue.
create function enqueue_due_episodes() returns int
language plpgsql security definer set search_path = public as $$
declare
  n int := 0;
  ep episodes;
begin
  for ep in select * from create_due_episodes(now(), interval '60 minutes') loop
    perform pgmq.send('episode_jobs', jsonb_build_object('episode_id', ep.id));
    n := n + 1;
  end loop;
  return n;
end $$;

select cron.schedule('enqueue-episodes', '*/5 * * * *', $$select enqueue_due_episodes()$$);

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
