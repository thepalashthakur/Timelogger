# Timelogger

A Vercel ready Next.js time tracker using Supabase Auth, Supabase Postgres, and Material UI.

## Setup

1. In your existing Supabase project, review and run `supabase/schema.sql` in its SQL editor. It creates only `timelogger_` objects in one transaction. A name collision aborts the migration without touching existing tables or data.
2. Copy `.env.example` to `.env.local` and set `SUPABASE_URL` and `SUPABASE_ANON_KEY` to the project URL and publishable/anon key. The server passes the public anon key to the browser for login. The service role key is not used by this app.
3. Enable email/password authentication in Supabase. Configure the site URL for localhost and your Vercel domain; choose your email confirmation setting.
4. Run `npm install` and `npm run dev`.
5. Add the same two environment variables in your Vercel project and deploy.

The API accepts a Supabase access token in `Authorization: Bearer <token>`. See `FEATURES.md` for release scope.

## Timer API

Use a Supabase access token from a signed-in account. All endpoints require
`Authorization: Bearer <access_token>`; data is restricted to that user.

| Method | Path | Body / result |
| --- | --- | --- |
| `GET` | `/api/timer` | Current running or paused entry, if any |
| `POST` | `/api/timer` | `{ "action": "start", "project": "Website", "task": "Design", "description": "Header" }` |
| `POST` | `/api/timer` | `{ "action": "pause" }`, `{ "action": "resume" }`, or `{ "action": "stop" }` |
| `GET` | `/api/entries` | 100 most recent entries |
| `POST` | `/api/entries` | `{ "project": "Website", "task": "Review", "description": "QA", "start_at": "2026-10-20T09:00:00Z", "end_at": "2026-10-20T10:00:00Z" }` |

For example:

```sh
curl -X POST "$APP_URL/api/timer" \
  -H "Authorization: Bearer $SUPABASE_ACCESS_TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"action":"pause"}'
```

The duration is stored in the `public.timelogger_time_entries` table. The browser only displays elapsed time from
persisted timestamps, so a timer continues when the tab or browser is closed.
At most one timer can be running or paused per user.

## Git history in this workspace

This environment blocks creating the usual `.git` directory. Feature commits are
stored in `.timelogger-git`. To inspect them here, use
`git --git-dir=.timelogger-git --work-tree=. log --oneline`. In a normal filesystem,
rename `.timelogger-git` to `.git` for standard Git commands.
