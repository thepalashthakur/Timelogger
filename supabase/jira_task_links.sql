-- v0.16: records the Jira site for issues imported through Forge.
-- Creates only a new timelogger_ table; existing tables and rows are unchanged.
begin;

create table public.timelogger_jira_task_links (
  task_id uuid primary key references public.timelogger_tasks(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  site_url text not null check (site_url ~ '^https://[a-z0-9][a-z0-9-]*\.atlassian\.net$'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index timelogger_jira_task_links_user on public.timelogger_jira_task_links(user_id);
alter table public.timelogger_jira_task_links enable row level security;
revoke all on public.timelogger_jira_task_links from public, anon, authenticated;
grant select, insert, update, delete on public.timelogger_jira_task_links to service_role;

commit;
