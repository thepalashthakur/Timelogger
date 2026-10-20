-- v0.5 additive catalog migration for an existing Supabase database.
-- Creates only timelogger-prefixed tables; does not alter existing tables or data.
-- Run after schema.sql and api_tokens.sql. A name collision aborts the transaction.
begin;

create table public.timelogger_projects (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  key text not null check (length(key) between 1 and 100),
  name text not null check (length(name) between 1 and 200),
  color text not null default '#1976D2' check (color ~ '^#[0-9A-Fa-f]{6}$'),
  archived boolean not null default false,
  created_at timestamptz not null default now(),
  unique (user_id, key)
);

create table public.timelogger_tasks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  project_id uuid not null references public.timelogger_projects(id) on delete cascade,
  key text not null check (length(key) between 1 and 100),
  name text not null check (length(name) between 1 and 200),
  archived boolean not null default false,
  created_at timestamptz not null default now(),
  unique (project_id, key)
);

create table public.timelogger_tags (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null check (length(name) between 1 and 100),
  color text not null default '#757575' check (color ~ '^#[0-9A-Fa-f]{6}$'),
  created_at timestamptz not null default now()
);
create unique index timelogger_tags_user_name on public.timelogger_tags(user_id, lower(name));

create table public.timelogger_entry_tags (
  user_id uuid not null references auth.users(id) on delete cascade,
  entry_id uuid not null references public.timelogger_time_entries(id) on delete cascade,
  tag_id uuid not null references public.timelogger_tags(id) on delete cascade,
  primary key (entry_id, tag_id)
);
create index timelogger_entry_tags_user_entry on public.timelogger_entry_tags(user_id, entry_id);
create index timelogger_entry_tags_tag_user on public.timelogger_entry_tags(tag_id, user_id);

alter table public.timelogger_projects enable row level security;
alter table public.timelogger_tasks enable row level security;
alter table public.timelogger_tags enable row level security;
alter table public.timelogger_entry_tags enable row level security;
revoke all on public.timelogger_projects, public.timelogger_tasks, public.timelogger_tags, public.timelogger_entry_tags from public, anon, authenticated;
grant select, insert, update, delete on public.timelogger_projects, public.timelogger_tasks, public.timelogger_tags, public.timelogger_entry_tags to service_role;

create function public.timelogger_set_entry_tags(p_user_id uuid, p_entry_id uuid, p_tag_ids uuid[])
returns void language plpgsql security invoker set search_path = ''
as $$
begin
  if current_user <> 'service_role' then raise exception 'Unauthorized'; end if;
  if not exists (select 1 from public.timelogger_time_entries where id = p_entry_id and user_id = p_user_id) then
    raise exception 'Entry not found';
  end if;
  if exists (
    select 1 from unnest(coalesce(p_tag_ids, array[]::uuid[])) as requested(id)
    left join public.timelogger_tags tag on tag.id = requested.id and tag.user_id = p_user_id
    where tag.id is null
  ) then raise exception 'Invalid tag'; end if;
  delete from public.timelogger_entry_tags where entry_id = p_entry_id and user_id = p_user_id;
  insert into public.timelogger_entry_tags(user_id, entry_id, tag_id)
    select p_user_id, p_entry_id, id from (select distinct unnest(coalesce(p_tag_ids, array[]::uuid[])) as id) requested;
end;
$$;
revoke all on function public.timelogger_set_entry_tags(uuid,uuid,uuid[]) from public, anon, authenticated;
grant execute on function public.timelogger_set_entry_tags(uuid,uuid,uuid[]) to service_role;

commit;
