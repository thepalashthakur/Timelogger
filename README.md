# Timelogger

A Vercel ready Next.js time tracker using Supabase Auth, Supabase Postgres, and Material UI.

## Setup

1. In your existing Supabase project, review and run `supabase/schema.sql`, then `supabase/api_tokens.sql`, in its SQL editor. Each creates only `timelogger_` objects in a transaction. A name collision aborts that migration without changing existing tables or data.
2. Copy `.env.example` to `.env.local` and set `SUPABASE_URL` and `SUPABASE_ANON_KEY` to the project URL and publishable/anon key. Set `SUPABASE_SERVICE_ROLE_KEY` for the server-only personal token routes. The service role key must never be exposed to the browser or Jira app.
3. Enable email/password authentication in Supabase. Configure the site URL for localhost and your Vercel domain; choose your email confirmation setting.
4. Run `npm install` and `npm run dev`.
5. Add the same two environment variables in your Vercel project and deploy.

The API accepts a Supabase access token or personal API token in `Authorization: Bearer <token>`. See `FEATURES.md` for release scope.

The Jira Cloud issue panel lives in [`forge/`](forge/README.md). It requires separate Forge registration and installation.

## Timer API

Use a Supabase access token from a signed-in account or create a personal token in
Settings. The timer and entry endpoints require `Authorization: Bearer <token>`;
data is restricted to that user. Personal tokens cannot create or revoke tokens.

| Method | Path | Body / result |
| --- | --- | --- |
| `GET` | `/api/timer` | Current running or paused entry, if any |
| `POST` | `/api/timer` | `{ "action": "start", "project": "Website", "task": "Design", "description": "Header" }` |
| `POST` | `/api/timer` | `{ "action": "pause" }`, `{ "action": "resume" }`, or `{ "action": "stop" }` |
| `GET` | `/api/entries` | Paginated entries; defaults to the 100 most recent |
| `POST` | `/api/entries` | `{ "project": "Website", "task": "Review", "description": "QA", "start_at": "2026-10-20T09:00:00Z", "end_at": "2026-10-20T10:00:00Z" }` |

Token management requires a Supabase login session. `GET /api/tokens` lists token
metadata, `POST /api/tokens` with `{ "name": "Jira" }` creates a token, and
`DELETE /api/tokens/{id}` revokes one. The plaintext token is returned only at
creation, expires after 90 days, and can be revoked immediately. Store it in
the Jira app's encrypted secret storage; do not put it in Jira frontend code.

The web app's **Time entries** view searches the full history. `GET /api/entries`
accepts optional `page` (starting at 1), `page_size` (1–100), `q` (case-insensitive
search across project, task, and description), `project`, `status`, `from`, and
`to`. `from` is inclusive and `to` is exclusive for the entry start time. The
response includes `entries`, `count`, `page`, and `page_size`. The API requires
the same bearer authentication as before.

For example:

```sh
curl -X POST "$APP_URL/api/timer" \
  -H "Authorization: Bearer $TIMELOGGER_API_TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"action":"pause"}'
```

The duration is stored in the `public.timelogger_time_entries` table. The browser only displays elapsed time from
persisted timestamps, so a timer continues when the tab or browser is closed.
At most one timer can be running or paused per user.
