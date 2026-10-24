-- Additive migration for direct, per-user Google Calendar OAuth sync.
-- Creates only new timelogger-prefixed tables; does not alter existing data.
-- Run after calendar_sync.sql and calendar_webhook.sql.
begin;

create table public.timelogger_google_connections (
  user_id uuid primary key references auth.users(id) on delete cascade,
  refresh_token_encrypted text not null,
  calendar_id text not null,
  calendar_name text not null,
  connected_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- No entry foreign key: failed remote deletes remain retryable after local deletion.
create table public.timelogger_google_sync (
  user_id uuid not null references auth.users(id) on delete cascade,
  entry_id uuid not null,
  calendar_id text not null,
  event_id text,
  html_link text,
  desired_action text not null check (desired_action in ('upsert', 'delete')),
  payload jsonb,
  status text not null default 'pending' check (status in ('pending', 'synced', 'failed')),
  attempts integer not null default 0 check (attempts >= 0),
  last_error text,
  updated_at timestamptz not null default now(),
  primary key (user_id, entry_id)
);
create index timelogger_google_sync_retry on public.timelogger_google_sync(user_id, status, updated_at);

alter table public.timelogger_google_connections enable row level security;
alter table public.timelogger_google_sync enable row level security;
revoke all on public.timelogger_google_connections, public.timelogger_google_sync from public, anon, authenticated;
grant select, insert, update, delete on public.timelogger_google_connections, public.timelogger_google_sync to service_role;

commit;
