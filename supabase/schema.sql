-- Additive migration for an existing Supabase database.
-- Creates only timelogger-prefixed objects. A name collision fails and rolls back.
-- No existing application table, row, function, or extension is modified.
begin;

create table public.timelogger_time_entries (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade default auth.uid(),
  project text not null default '' check (length(project) <= 500),
  task text not null default '' check (length(task) <= 500),
  description text not null default '' check (length(description) <= 500),
  status text not null check (status in ('running', 'paused', 'stopped')),
  start_at timestamptz not null,
  end_at timestamptz,
  last_resumed_at timestamptz,
  elapsed_seconds bigint not null default 0 check (elapsed_seconds >= 0),
  created_at timestamptz not null default now(),
  constraint timelogger_valid_entry_period check (end_at is null or end_at > start_at),
  constraint timelogger_valid_timer_state check (
    (status = 'running' and end_at is null and last_resumed_at is not null) or
    (status = 'paused' and end_at is null and last_resumed_at is null) or
    (status = 'stopped' and end_at is not null and last_resumed_at is null)
  )
);

create unique index timelogger_one_active_timer_per_user
  on public.timelogger_time_entries(user_id) where status in ('running', 'paused');
create index timelogger_time_entries_user_start
  on public.timelogger_time_entries(user_id, start_at desc);

alter table public.timelogger_time_entries enable row level security;
revoke all on public.timelogger_time_entries from public, anon;
grant select, insert on public.timelogger_time_entries to authenticated;
create policy "timelogger_read_own_entries" on public.timelogger_time_entries for select to authenticated using (user_id = (select auth.uid()));
create policy "timelogger_insert_own_entries" on public.timelogger_time_entries for insert to authenticated with check (user_id = (select auth.uid()));
-- Timer transitions are performed by the functions below, not arbitrary client updates.

create function public.timelogger_start_timer(p_project text default '', p_task text default '', p_description text default '')
returns public.timelogger_time_entries
language plpgsql security invoker set search_path = ''
as $$
declare result public.timelogger_time_entries;
begin
  if auth.uid() is null then raise exception 'Unauthorized'; end if;
  if length(p_project) > 500 or length(p_task) > 500 or length(p_description) > 500 then
    raise exception 'Entry details are too long';
  end if;
  insert into public.timelogger_time_entries (user_id, project, task, description, status, start_at, last_resumed_at)
  values (auth.uid(), coalesce(p_project, ''), coalesce(p_task, ''), coalesce(p_description, ''), 'running', clock_timestamp(), clock_timestamp())
  returning * into result;
  return result;
exception when unique_violation then
  raise exception 'An active timer already exists';
end;
$$;

create function public.timelogger_transition_timer(p_action text)
returns public.timelogger_time_entries
language plpgsql security definer set search_path = ''
as $$
declare result public.timelogger_time_entries;
begin
  if auth.uid() is null then raise exception 'Unauthorized'; end if;
  if p_action not in ('pause', 'resume', 'stop') then raise exception 'Invalid timer action'; end if;
  select * into result from public.timelogger_time_entries
    where user_id = auth.uid() and status in ('running', 'paused') for update;
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

revoke all on function public.timelogger_start_timer(text,text,text) from public, anon;
revoke all on function public.timelogger_transition_timer(text) from public, anon;
grant execute on function public.timelogger_start_timer(text,text,text) to authenticated;
grant execute on function public.timelogger_transition_timer(text) to authenticated;

commit;
