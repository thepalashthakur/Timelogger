-- v0.11 additive hierarchy metadata. Does not change existing tables or rows.
begin;

create table public.timelogger_task_hierarchy (
  task_id uuid primary key references public.timelogger_tasks(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  parent_task_id uuid references public.timelogger_tasks(id) on delete set null,
  issue_type text not null default 'Task' check (length(issue_type) between 1 and 100),
  source text not null default 'manual' check (source in ('manual', 'jira')),
  updated_at timestamptz not null default now(),
  check (parent_task_id is distinct from task_id)
);
create index timelogger_task_hierarchy_user_parent on public.timelogger_task_hierarchy(user_id, parent_task_id);
alter table public.timelogger_task_hierarchy enable row level security;
revoke all on public.timelogger_task_hierarchy from public, anon, authenticated;
grant select, insert, update, delete on public.timelogger_task_hierarchy to service_role;

create function public.timelogger_set_task_hierarchy(
  p_user_id uuid, p_task_id uuid, p_parent_task_id uuid, p_issue_type text, p_source text
) returns void language plpgsql security invoker set search_path = '' as $$
declare task_project uuid; parent_project uuid;
begin
  if current_user <> 'service_role' then raise exception 'Unauthorized'; end if;
  if p_issue_type is null or length(trim(p_issue_type)) not between 1 and 100 or p_source not in ('manual', 'jira') then
    raise exception 'Invalid task type';
  end if;
  -- Serialize changes for one user's tree so concurrent edits cannot introduce a cycle.
  perform pg_advisory_xact_lock(hashtextextended(p_user_id::text, 0));
  select project_id into task_project from public.timelogger_tasks where id = p_task_id and user_id = p_user_id;
  if task_project is null then raise exception 'Task not found'; end if;
  if p_parent_task_id is not null then
    select project_id into parent_project from public.timelogger_tasks
      where id = p_parent_task_id and user_id = p_user_id and archived = false;
    if parent_project is null or parent_project <> task_project then raise exception 'Parent must be an active task in the same project'; end if;
    if exists (
      with recursive ancestors(id, parent_id, path) as (
        select t.id, h.parent_task_id, array[t.id]
        from public.timelogger_tasks t left join public.timelogger_task_hierarchy h on h.task_id = t.id
        where t.id = p_parent_task_id
        union all
        select t.id, h.parent_task_id, a.path || t.id
        from ancestors a join public.timelogger_tasks t on t.id = a.parent_id
        left join public.timelogger_task_hierarchy h on h.task_id = t.id
        where not t.id = any(a.path)
      ) select 1 from ancestors where id = p_task_id
    ) then raise exception 'Task hierarchy cannot contain a cycle'; end if;
  end if;
  insert into public.timelogger_task_hierarchy(task_id, user_id, parent_task_id, issue_type, source)
    values(p_task_id, p_user_id, p_parent_task_id, trim(p_issue_type), p_source)
    on conflict (task_id) do update set parent_task_id = excluded.parent_task_id,
      issue_type = excluded.issue_type, source = excluded.source, updated_at = now();
end;
$$;
revoke all on function public.timelogger_set_task_hierarchy(uuid,uuid,uuid,text,text) from public, anon, authenticated;
grant execute on function public.timelogger_set_task_hierarchy(uuid,uuid,uuid,text,text) to service_role;

create function public.timelogger_task_totals(p_user_id uuid)
returns table(task_id uuid, seconds bigint) language sql security invoker set search_path = '' as $$
  select task.id, coalesce(sum(entry.elapsed_seconds + case
    when entry.status = 'running' and entry.last_resumed_at is not null
      then greatest(0, floor(extract(epoch from clock_timestamp() - entry.last_resumed_at))::bigint)
    else 0 end), 0)::bigint
  from public.timelogger_tasks task
  join public.timelogger_projects project on project.id = task.project_id and project.user_id = p_user_id
  join public.timelogger_time_entries entry on entry.user_id = p_user_id
    and entry.project = project.key and entry.task = task.key
  where task.user_id = p_user_id and current_user = 'service_role'
  group by task.id;
$$;
revoke all on function public.timelogger_task_totals(uuid) from public, anon, authenticated;
grant execute on function public.timelogger_task_totals(uuid) to service_role;

commit;
