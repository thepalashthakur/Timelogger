-- Additive migration for the shared secret in the user's Apps Script.
-- Run after calendar_sync.sql. Creates only a new timelogger-prefixed table.
begin;

create table public.timelogger_calendar_webhook_secrets (
  user_id uuid primary key references auth.users(id) on delete cascade,
  webhook_secret text not null check (length(webhook_secret) between 1 and 512),
  updated_at timestamptz not null default now()
);

alter table public.timelogger_calendar_webhook_secrets enable row level security;
revoke all on public.timelogger_calendar_webhook_secrets from public, anon, authenticated;
grant select, insert, update, delete on public.timelogger_calendar_webhook_secrets to service_role;

commit;
