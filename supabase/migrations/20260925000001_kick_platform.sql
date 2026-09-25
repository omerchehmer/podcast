-- Briefcast schema, part 5: start the GitHub worker from Supabase.
-- GitHub's own hourly schedule is often late or skipped on small repositories,
-- so pg_cron checks the queue and starts the worker (workflow_dispatch) when needed.
-- Needs Supabase-only extensions, so the local unit tests skip this file.
--
-- One-time setup (never commit the token):
--   select vault.create_secret('<fine-grained token, Actions: read and write>', 'github_kick_token');

create extension if not exists pg_net;

create table worker_kicks (
  id bigint generated always as identity primary key,
  at timestamptz not null default now(),
  request_id bigint
);
alter table worker_kicks enable row level security; -- no policies: server only

create function kick_worker_if_needed() returns boolean
language plpgsql security definer set search_path = public as $$
declare
  token text;
  rid bigint;
begin
  -- nothing to make yet
  if not exists (select 1 from episodes where status = 'queued' and scheduled_for <= now() + interval '3 hours') then
    return false;
  end if;
  -- at most one start every 20 minutes (a run takes a few minutes per episode)
  if exists (select 1 from worker_kicks where at > now() - interval '20 minutes') then
    return false;
  end if;
  select decrypted_secret into token from vault.decrypted_secrets where name = 'github_kick_token';
  if token is null then
    return false;
  end if;
  select net.http_post(
    url := 'https://api.github.com/repos/omerchehmer/podcast/actions/workflows/worker.yml/dispatches',
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || token,
      'Accept', 'application/vnd.github+json',
      'User-Agent', 'briefcast'),
    body := jsonb_build_object('ref', 'claude/briefcast-ios-backend-a98ufv')
  ) into rid;
  insert into worker_kicks (request_id) values (rid);
  delete from worker_kicks where at < now() - interval '7 days';
  return true;
end
$$;
revoke all on function kick_worker_if_needed() from public, authenticated, anon;

select cron.schedule('kick-worker', '*/10 * * * *', $$select kick_worker_if_needed()$$);
