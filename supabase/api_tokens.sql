-- Additive migration for personal API tokens. Run after schema.sql.
-- Creates only timelogger-prefixed objects; a name collision rolls everything back.
begin;

create table public.timelogger_api_tokens (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 80),
  token_hash text not null unique check (token_hash ~ '^[0-9a-f]{64}$'),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  last_used_at timestamptz,
  revoked_at timestamptz,
  constraint timelogger_token_expiry check (expires_at > created_at)
);

create index timelogger_api_tokens_user_id on public.timelogger_api_tokens(user_id, created_at desc);
alter table public.timelogger_api_tokens enable row level security;
revoke all on public.timelogger_api_tokens from public, anon, authenticated;
grant select, insert, update on public.timelogger_api_tokens to service_role;

-- Called only by the Vercel backend after it has validated a personal token.
-- The service role key stays server-side and never reaches the Jira app.
create function public.timelogger_api_transition_timer(p_user_id uuid, p_action text)
returns public.timelogger_time_entries
language plpgsql security invoker set search_path = ''
as $$
declare result public.timelogger_time_entries;
begin
  if current_user <> 'service_role' then raise exception 'Unauthorized'; end if;
  if p_action not in ('pause', 'resume', 'stop') then raise exception 'Invalid timer action'; end if;
  select * into result from public.timelogger_time_entries
    where user_id = p_user_id and status in ('running', 'paused') for update;
  if not found then raise exception 'No active timer'; end if;
  if p_action = 'pause' then
    if result.status <> 'running' then raise exception 'Timer is not running'; end if;
    update public.timelogger_time_entries set
      elapsed_seconds = elapsed_seconds + greatest(0, floor(extract(epoch from clock_timestamp() - last_resumed_at))::bigint),
      last_resumed_at = null, status = 'paused'
    where id = result.id returning * into result;
  elsif p_action = 'resume' then
    if result.status <> 'paused' then raise exception 'Timer is not paused'; end if;
    update public.timelogger_time_entries set last_resumed_at = clock_timestamp(), status = 'running'
    where id = result.id returning * into result;
  else
    update public.timelogger_time_entries set
      elapsed_seconds = elapsed_seconds + case when status = 'running' then greatest(0, floor(extract(epoch from clock_timestamp() - last_resumed_at))::bigint) else 0 end,
      last_resumed_at = null, end_at = clock_timestamp(), status = 'stopped'
    where id = result.id returning * into result;
  end if;
  return result;
end;
$$;

revoke all on function public.timelogger_api_transition_timer(uuid,text) from public, anon, authenticated;
grant execute on function public.timelogger_api_transition_timer(uuid,text) to service_role;

commit;
