-- Briefcast schema, part 2: Row Level Security.
-- Rule: a signed-in user can only see their own rows.
-- Tables written by the backend (episodes, subscriptions, cost_log …) are read-only for users.
-- The worker and Edge Functions use the service role, which bypasses RLS.

alter table profiles enable row level security;
alter table podcast_settings enable row level security;
alter table listener_context enable row level security;
alter table topic_categories enable row level security;
alter table interests enable row level security;
alter table sources enable row level security;
alter table user_sources enable row level security;
alter table inbound_addresses enable row level security;
alter table source_items enable row level security;
alter table episodes enable row level security;
alter table episode_segments enable row level security;
alter table episode_sources enable row level security;
alter table cost_log enable row level security;
alter table feedback enable row level security;
alter table segment_feedback enable row level security;
alter table preference_state enable row level security;
alter table voices enable row level security;
alter table listen_events enable row level security;
alter table episode_reports enable row level security;
alter table subscriptions enable row level security;
alter table push_tokens enable row level security;
alter table mcp_grants enable row level security;

-- Own rows: full access
create policy own_all on profiles for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy own_all on podcast_settings for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy own_all on interests for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy own_all on user_sources for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy own_all on push_tokens for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- Feedback: users write their own
create policy own_all on feedback for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy own_all on segment_feedback for all to authenticated
  using (exists (select 1 from feedback f where f.id = feedback_id and f.user_id = auth.uid()))
  with check (exists (select 1 from feedback f where f.id = feedback_id and f.user_id = auth.uid()));

-- Listening events and reports: insert and read own
create policy own_select on listen_events for select to authenticated using (user_id = auth.uid());
create policy own_insert on listen_events for insert to authenticated
  with check (user_id = auth.uid() and exists (select 1 from episodes e where e.id = episode_id and e.user_id = auth.uid()));
create policy own_select on episode_reports for select to authenticated using (user_id = auth.uid());
create policy own_insert on episode_reports for insert to authenticated
  with check (user_id = auth.uid() and exists (select 1 from episodes e where e.id = episode_id and e.user_id = auth.uid()));

-- Listener context: users may read (ciphertext only) and delete. Writes go through the
-- `context` Edge Function, which scrubs sensitive data and encrypts first.
create policy own_select on listener_context for select to authenticated using (user_id = auth.uid());
create policy own_delete on listener_context for delete to authenticated using (user_id = auth.uid());

-- Read-only for users (written by the backend)
create policy own_select on episodes for select to authenticated using (user_id = auth.uid());
create policy own_select on episode_segments for select to authenticated
  using (exists (select 1 from episodes e where e.id = episode_id and e.user_id = auth.uid()));
create policy own_select on episode_sources for select to authenticated
  using (exists (select 1 from episodes e where e.id = episode_id and e.user_id = auth.uid()));
create policy own_select on preference_state for select to authenticated using (user_id = auth.uid());
create policy own_select on subscriptions for select to authenticated using (user_id = auth.uid());
create policy own_select on inbound_addresses for select to authenticated using (user_id = auth.uid());
create policy own_select on mcp_grants for select to authenticated using (user_id = auth.uid());
-- Users can revoke a connected assistant (set revoked_at).
create policy own_update on mcp_grants for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- Shared catalog: public sources for everyone, private sources only for their owner
create policy read_visible on sources for select to authenticated
  using (owner_user_id is null or owner_user_id = auth.uid());
create policy read_visible on source_items for select to authenticated
  using (owner_user_id is null or owner_user_id = auth.uid());

-- Reference data
create policy read_all on topic_categories for select to authenticated using (true);
create policy read_all on voices for select to authenticated using (active);

-- cost_log: no policy = no access for users.

-- ---------- New user setup ----------
-- When someone signs up, create their default rows.
create function handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into profiles (user_id) values (new.id) on conflict do nothing;
  insert into podcast_settings (user_id) values (new.id) on conflict do nothing;
  insert into preference_state (user_id) values (new.id) on conflict do nothing;
  return new;
end $$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function handle_new_user();
