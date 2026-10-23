# Timelogger

A Vercel ready Next.js time tracker using Supabase Auth, Supabase Postgres, and Material UI.

## Deploy the web app

These steps use the existing Supabase project and the Vercel project connected to this repository. The Jira issue panel is a separate Forge deployment described below.

1. **Apply the database migrations.** In the Supabase SQL Editor, review and run `supabase/schema.sql`, then `supabase/api_tokens.sql`, then `supabase/catalog.sql`, then `supabase/calendar_sync.sql` for a new Timelogger installation. For an existing installation, apply only migrations that have not yet been run; v0.6 needs `supabase/calendar_sync.sql`. The migrations create only `timelogger_` objects and do not alter existing tables or data. Do not rerun a migration that has already been applied.
2. **Configure Supabase Auth.** Enable email/password sign-in. Set the Auth site URL to your deployed web app URL (currently `https://timelogger-gilt.vercel.app`). If you use email confirmations, configure the allowed redirect URLs for the deployed domain and `http://localhost:3000` for local development.
3. **Set the Vercel environment variables.** In the Timelogger project's Vercel settings, add `SUPABASE_URL`, `SUPABASE_ANON_KEY`, and `SUPABASE_SERVICE_ROLE_KEY` to the Production environment. Use the Supabase project URL, its anon/publishable key, and its service role key respectively. The service role key is required for personal API tokens and stays server-side; never put it in browser code or Forge. Add the same values to Preview only if you deploy previews. Redeploy after changing environment variables.
4. **Check the app locally.** From the repository root, copy `.env.example` to `.env.local`, fill in the three values, then run:

   ```sh
   npm install
   npm run build
   npm run dev
   ```

   Open `http://localhost:3000` and sign in.
5. **Release to Vercel.** Push the commit to the Git branch connected to Vercel production (`main` for this project): `git push origin main`. Vercel builds and deploys that commit automatically. In Vercel **Deployments**, wait for the production deployment to show **Ready** and check that its commit matches the one you pushed. Open `https://timelogger-gilt.vercel.app`, sign in, and verify a timer and a time entry. For v0.5, open **Projects & tags** and verify that its catalog loads. Use **Import existing entries** there if you want to populate managed projects and tasks from older entries.

For local development, `.env.local` is ignored by Git. Do not commit keys or personal API tokens. A successful Vercel deployment does not update the Jira app; deploy Forge separately.

## Deploy the Jira issue panel

The Forge app is already registered in `forge/manifest.yml` and installed on `projects-1.atlassian.net`. For an update, run these commands from the repository root after the web app is live:

```sh
cd forge
npm install
npm --prefix static install
npm run build
npx forge login
npx forge lint
npx forge deploy --environment development
```

`forge login` asks for the Atlassian account email and its Forge CLI API token. The repository's `.env` is not loaded automatically by Forge. Use `npx forge install --upgrade --site projects-1.atlassian.net --product Jira --environment development` if Forge reports that the existing Jira installation needs an upgrade or new permissions. Open a Jira issue and expand **Timelogger** to verify it. In the web app's **Settings**, create a Timelogger personal API token and paste it into the Jira panel when prompted; this is different from the Forge CLI token.

The Forge resolver reads `TIMELOGGER_API_ORIGIN`; the outbound domain in `forge/manifest.yml` currently allows `https://timelogger-gilt.vercel.app`. If the web app domain changes, update the manifest origin, run `npx forge variables set --environment development TIMELOGGER_API_ORIGIN https://<your-domain>`, and deploy Forge again. If installing on a different Jira site or environment, use its site host and the same environment consistently for the variable, deployment, and installation. See the [Forge README](forge/README.md) for first-time installation.

The API accepts a Supabase access token or personal API token in `Authorization: Bearer <token>`. See `FEATURES.md` for release scope.

The Jira Cloud issue panel lives in [`forge/`](forge/README.md). It requires separate Forge registration and installation.

## Google Calendar sync

Each user connects their own Google Calendar through a Google Apps Script Web app:

1. In Timelogger **Settings → Google Calendar**, expand **Apps Script code and setup steps** and copy the script.
2. In the Google account whose default calendar should receive entries, create a project at [Google Apps Script](https://script.google.com/), paste the code into `Code.gs`, and deploy it as a **Web app**. Choose **Execute as: Me** and **Who has access: Anyone** so the Timelogger server can call it. Authorize Calendar access when prompted. Keep the deployment URL private because it grants access to this bridge.
3. Copy the deployed URL ending in `/exec`, paste it into Timelogger Settings, and click **Save URL**. The URL is stored for that Timelogger user in `public.timelogger_calendar_integrations` and used only by the server.
4. Create a completed time entry, or stop a timer. Check for the matching Google Calendar event. Editing or deleting that entry updates or deletes its event. If delivery fails, the entry change still succeeds; Settings shows the failed sync with a **Retry** button.

Running and paused timers are synced when stopped, after their final end time is known. Existing entries are not imported into Calendar automatically. If the Apps Script code changes, publish a new deployment version before testing it. The Calendar integration requires `supabase/calendar_sync.sql` to be applied before deploying this app version.

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
| `GET` | `/api/entries/{id}` | One entry owned by the authenticated user |
| `PATCH` | `/api/entries/{id}` | Update project, task, or description on any entry; completed entries also support start/end changes that recalculate duration |
| `DELETE` | `/api/entries/{id}` | Delete an entry; deleting a running or paused entry removes its active timer |
| `GET` | `/api/timeline?from=<ISO>&to=<ISO>` | Entries overlapping a period of up to 32 days; returns `entries`, `count`, and `truncated` (500 entry limit) |
| `GET` | `/api/catalog` | Managed projects, tasks, and tags for the authenticated user |
| `POST` | `/api/catalog` | Create `{ "kind": "project" | "task" | "tag", "name": "...", ... }` |
| `POST` | `/api/catalog/import` | Add managed projects and tasks from the user's existing entries without changing those entries |
| `PATCH` | `/api/catalog/{projects|tasks|tags}/{id}` | Rename or change color; archive/restore projects and tasks |
| `DELETE` | `/api/catalog/{projects|tasks|tags}/{id}` | Archive a project/task or permanently delete a tag |
| `GET` | `/api/entry-tags?ids=<comma-separated-entry-ids>` | Tag IDs assigned to the requested entries |
| `PUT` | `/api/entry-tags` | Replace an entry's tags with `{ "entry_id": "...", "tag_ids": ["..."] }` |
| `GET`, `PUT`, `DELETE` | `/api/calendar/settings` | Read, save, or disconnect the signed-in user's Apps Script URL |
| `GET`, `POST` | `/api/calendar/sync` | Read failed or pending deliveries; retry up to five |

Token management requires a Supabase login session. `GET /api/tokens` lists token
metadata, `POST /api/tokens` with `{ "name": "Jira" }` creates a token, and
`DELETE /api/tokens/{id}` revokes one. The plaintext token is returned only at
creation, expires after 90 days, and can be revoked immediately. Store it in
the Jira app's encrypted secret storage; do not put it in Jira frontend code.

The web app's **Time entries** view searches the full history. `GET /api/entries`
accepts optional `page` (starting at 1), `page_size` (1–100), `q` (case-insensitive
search across project, task, and description), `project`, `task`, `tag_id`, `status`, `from`, and
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
