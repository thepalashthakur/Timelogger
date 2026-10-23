-- Additive migration for each user's Google Calendar Apps Script integration.
-- Creates only timelogger-prefixed tables; leaves existing tables and rows intact.
-- Run after schema.sql. A name collision aborts the transaction.
begin;

create table public.timelogger_calendar_integrations (
  user_id uuid primary key references auth.users(id) on delete cascade,
  script_url text not null check (length(script_url) <= 2048),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Keep desired Calendar state even after a time entry is deleted, so a failed
-- remote deletion can be retried. The entry_id deliberately has no foreign key.
create table public.timelogger_calendar_sync (
  user_id uuid not null references auth.users(id) on delete cascade,
  entry_id uuid not null,
  event_id text,
  desired_action text not null check (desired_action in ('upsert', 'delete')),
  payload jsonb,
  status text not null default 'pending' check (status in ('pending', 'synced', 'failed')),
  attempts integer not null default 0 check (attempts >= 0),
  last_error text,
  updated_at timestamptz not null default now(),
  primary key (user_id, entry_id)
);
create index timelogger_calendar_sync_retry on public.timelogger_calendar_sync(user_id, status, updated_at);

alter table public.timelogger_calendar_integrations enable row level security;
alter table public.timelogger_calendar_sync enable row level security;
revoke all on public.timelogger_calendar_integrations, public.timelogger_calendar_sync from public, anon, authenticated;
grant select, insert, update, delete on public.timelogger_calendar_integrations, public.timelogger_calendar_sync to service_role;

commit;
