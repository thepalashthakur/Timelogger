# Timelogger

A Vercel ready Next.js time tracker using UseAuth, Supabase Postgres, and Material UI.

## Deploy the web app

These steps use the existing Supabase project and the Vercel project connected to this repository. The Jira issue panel is a separate Forge deployment described below.

### UseAuth prerequisite for v0.17

UseAuth already provides hosted forgot and reset password pages. The [UseAuth v1.1.0 patch](integration/useauth-v1.1.0.patch) adds only the token API actions Timelogger needs for signed-in password changes and profile edits. It is based on UseAuth commit `35e238c` and was checked against that repository. Apply it from this repository with write access to `../UseAuth`:

```sh
git -C ../UseAuth am ../Timelogger/integration/useauth-v1.1.0.patch
```

Deploy UseAuth with this patch first. Timelogger now uses the Supabase project already owned by UseAuth; its previous time entries, catalog, tokens, and Google connections are not copied. Apply Timelogger's additive `timelogger_` migrations to that project before deploying the web app. Then set `USEAUTH_URL` in Timelogger's Vercel environment and deploy Timelogger. Its server verifies each UseAuth session against the configured Supabase project. Recreate personal API tokens and relink the Forge app after signing in.

1. **Apply the database migrations.** In the Supabase SQL Editor, review and run `supabase/schema.sql`, then `supabase/api_tokens.sql`, then `supabase/catalog.sql`, then `supabase/calendar_sync.sql`, then `supabase/calendar_webhook.sql`, then `supabase/google_calendar.sql`, then `supabase/task_hierarchy.sql`, then `supabase/jira_task_links.sql` for a new Timelogger installation. For an existing installation, apply only migrations that have not yet been run. The v0.16 Jira link migration creates only a new `timelogger_` table and does not alter existing tables or data. Do not rerun a migration that has already been applied.
2. **Configure Supabase Auth and UseAuth.** Enable email/password sign-in and **Confirm email**. Use the existing UseAuth Supabase project for Timelogger’s `SUPABASE_URL`, `SUPABASE_ANON_KEY`, and `SUPABASE_SERVICE_ROLE_KEY`. Keep UseAuth’s current confirmation and recovery settings. The UseAuth README describes optional return URLs if you want reset links to return directly to Timelogger.
3. **Set the Vercel environment variables.** In the Timelogger project's Vercel settings, add `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, and `USEAUTH_URL` to the Production environment. Use the Supabase project URL, its anon/publishable key, and its service role key respectively. Set `USEAUTH_URL` to the exact HTTPS UseAuth origin, such as `https://use-auth-rosy.vercel.app`, without a trailing slash. The service role key is required for personal API tokens and stays server-side; never put it in browser code or Forge. Add the same values to Preview only if you deploy previews. Redeploy after changing environment variables.
4. **Check the app locally.** From the repository root, copy `.env.example` to `.env.local`, fill in the Supabase values and UseAuth URL, then run:

   ```sh
   npm install
   npm run build
   npm run dev
   ```

   Open `http://localhost:3000` and sign in.
5. **Release to Vercel.** Push the commit to the Git branch connected to Vercel production (`main` for this project): `git push origin main`. Vercel builds and deploys that commit automatically. In Vercel **Deployments**, wait for the production deployment to show **Ready** and check that its commit matches the one you pushed. Open `https://timelogger-gilt.vercel.app`, sign in, and verify a timer and a time entry. For v0.5, open **Projects & tags** and verify that its catalog loads. Use **Import existing entries** there if you want to populate managed projects and tasks from older entries.

For local development, `.env.local` is ignored by Git. Do not commit keys or personal API tokens. A successful Vercel deployment does not update the Jira app; deploy Forge separately.

## Password recovery

On the sign-in screen, **Forgot password?** asks UseAuth to send a reset email. The link opens UseAuth’s existing hosted new-password form. After resetting, the user can return to Timelogger and sign in. The message after requesting a link is the same whether or not the email belongs to an account.

Signed-in users can change their password in **Settings** through UseAuth by providing their current password. If Supabase requires reauthentication for an older session, **Send verification code** emails a code to enter with the change. Timelogger stores UseAuth sessions in HttpOnly cookies; its personal API tokens and Forge integration continue to work. No Timelogger database migration is required.

## Deploy the Jira issue panel

The Forge app is already registered in `forge/manifest.yml` and installed on `projects-1.atlassian.net`. For an update, run these commands from the repository root after the web app is live:

```sh
cd forge
npm install
npm --prefix static install
npm run build
npx forge login
npx forge lint
npx forge deploy --environment development --approve MAJOR_VERSION_RULE
npx forge install --upgrade --site projects-1.atlassian.net --product Jira --environment development
```

`forge login` asks for the Atlassian account email and its Forge CLI API token. The repository's `.env` is not loaded automatically by Forge. **v0.11 adds the `read:jira-work` scope**. The Forge linter reports `MAJOR_VERSION_RULE` approval for this permission change; `--approve MAJOR_VERSION_RULE` acknowledges the major version during deployment. The following `install --upgrade` applies the new permission to the existing Jira installation and may require Jira administrator consent. Open a Jira issue and expand **Timelogger** to verify it. In the web app's **Settings**, create a Timelogger personal API token and paste it into the Jira panel when prompted; this is different from the Forge CLI token.

## Nested Jira tasks (v0.11)

Apply [`supabase/task_hierarchy.sql`](supabase/task_hierarchy.sql) before releasing the web app. It adds a separate table for task parent links and issue types, plus scoped database functions for validation and time totals. Existing tasks remain root-level until you arrange them. Existing time entries stay attached by their project and task keys.

In **Projects, tasks & tags**, choose **New task** or **Edit** to set an issue type and a parent in the same project. **Add child** creates a child under the selected task. The list shows direct tracked time and time including descendants. A task can have any number of nested levels; parent cycles are rejected. Archived tasks remain visible so their historical time is included.

Starting a timer from the Jira panel now reads the issue and its ancestors through the Jira REST API, then creates or links the corresponding Timelogger tasks. The Jira issue type and summary are copied when first imported; a Timelogger name customized later is preserved. Jira cross-project parent links cannot fit within a single project tree, so those issues appear as roots of their own project. Forge reads at most ten levels. Existing Jira-linked tasks acquire their hierarchy when their timers are next started.

From v0.12, open **Details** on a time entry in the timeline, active timer, or history. The dialog shows clickable project and task breadcrumbs, direct children, and all-time tracked time for the selected level. It also keeps the entry's duration, status, description, tags, start/end times, and Calendar link in one place. Existing entries resolve their hierarchy through their stable project/task keys; entries without a matching catalog task display their key and an import hint. No new migration is needed.

## Analytics (v0.13)

The **Analytics** tab summarizes tracked time with date, project, nested task, tag, status, and text filters. Group by project, task path, top-level task, tag, day, or week; choose a bar, donut, or daily trend chart; and open recent entries from a breakdown group. The API is user-scoped and returns an explicit error above 20,000 matching entries. No migration or Forge update is needed. See [ANALYTICS.md](ANALYTICS.md) for report semantics and planned extensions.

The Forge resolver reads `TIMELOGGER_API_ORIGIN`; the outbound domain in `forge/manifest.yml` currently allows `https://timelogger-gilt.vercel.app`. If the web app domain changes, update the manifest origin, run `npx forge variables set --environment development TIMELOGGER_API_ORIGIN https://<your-domain>`, and deploy Forge again. If installing on a different Jira site or environment, use its site host and the same environment consistently for the variable, deployment, and installation. See the [Forge README](forge/README.md) for first-time installation.

For v0.16 Jira issue links, apply `supabase/jira_task_links.sql` and deploy the updated Forge app after the web app. Start a timer from a Jira issue to sync its site URL. That issue and its Jira ancestors then show **Open in Jira** chips in the task catalog and entry details. Older Jira tasks acquire links when synced again. A child created directly in Timelogger does not create a Jira issue or receive a Jira link.

The API accepts a Supabase access token or personal API token in `Authorization: Bearer <token>`. See `FEATURES.md` for release scope.

The Jira Cloud issue panel lives in [`forge/`](forge/README.md). It requires separate Forge registration and installation.

## Google Calendar sync

### Direct Google connection (v0.8)

1. In Google Cloud Console, create or select a project, enable the Google Calendar API, and configure the OAuth consent screen. Add the scopes `https://www.googleapis.com/auth/calendar.events.owned`, `https://www.googleapis.com/auth/calendar.calendarlist.readonly`, and `https://www.googleapis.com/auth/calendar.calendars`. Add yourself as a test user while the app is in Testing. For use by other accounts, complete Google's OAuth publication and verification requirements. Refresh tokens issued while the app is in Testing may expire after seven days.
2. Create an OAuth client of type **Web application**. Register `https://timelogger-gilt.vercel.app/api/google/callback` as an authorized redirect URI. For local development, also register `http://localhost:3000/api/google/callback` or use a separate local OAuth client.
3. Apply `supabase/google_calendar.sql` in the existing Supabase project's SQL Editor. It creates only new prefixed tables. Set these **server-side** Vercel environment variables: `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REDIRECT_URI=https://timelogger-gilt.vercel.app/api/google/callback`, and `GOOGLE_TOKEN_ENCRYPTION_KEY`. Generate the last value with `openssl rand -base64 32`, save it securely, and keep the same value across redeployments. Never expose the client secret or encryption key in browser code.
4. Redeploy the web app, sign in, then open **Settings → Direct Google Calendar → Connect Google Calendar**. Grant access and choose one of your owned calendars. Create a completed entry or stop a timer, then verify its event. You can open the event from the time entry list or timeline. Editing and deleting the entry update and delete its Google event. Failed changes appear in Settings with **Retry**.

Direct Google sync is one-way from Timelogger to Google Calendar. Running and paused timers sync after stop. The connection uses an encrypted per-user refresh token. New entries use the direct connection while it is active; entries already linked to Apps Script continue to use Apps Script. Changing the selected calendar affects only new entries. Disconnecting direct Google access stops sync for its linked entries until that user reconnects; it does not delete events already in Google Calendar.

From v0.9, **Settings → Direct Google Calendar → Create calendar** creates a secondary calendar in the connected Google account and selects it for future entries. If the account connected before v0.9, click **Reconnect** first to grant the new `calendar.calendars` permission. No additional database migration is needed for calendar creation.

### Apps Script connection (still supported)

Each user connects their own Google Calendar through a Google Apps Script Web app:

1. In Timelogger **Settings → Google Calendar**, expand **Apps Script code and setup steps** and copy the script. This version keeps the existing `source: "clockify"`, `action: "upsert"`, `idempotencyKey`, and `event` request format, and adds Timelogger upserts and deletes.
2. In the Google account whose calendar should receive entries, create a project at [Google Apps Script](https://script.google.com/) or update your existing Clockify script. Paste the code into `Code.gs`. In **Project Settings → Script properties**, set `CALENDAR_ID` to the target Google Calendar ID and `WEBHOOK_SECRET` to a strong random value. If you already use these properties for Clockify, keep their current values.
3. Deploy a new **Web app** version. Choose **Execute as: Me** and **Who has access: Anyone** so the Timelogger server can call it. Authorize Calendar access when prompted. Keep the deployment URL and secret private.
4. Copy the deployed URL ending in `/exec`, paste it into Timelogger Settings, enter the same `WEBHOOK_SECRET`, and click **Save connection**. The URL and secret are stored in separate user-scoped `timelogger_` tables. The secret is never returned by the settings API after saving.
5. Create a completed time entry, or stop a timer. Check for the matching Google Calendar event. Editing or deleting that entry updates or deletes its event. If delivery fails, the entry change still succeeds; Settings shows the failed sync with a **Retry** button.

Running and paused timers are synced when stopped, after their final end time is known. Existing entries are not imported into Calendar automatically. If the Apps Script code changes, publish a new deployment version before testing it. Apply both Calendar migrations before deploying this app version. The user's old script only supports Clockify upserts; Timelogger sync needs the updated script shown in Settings.

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
| `GET` | `/api/analytics?from=<ISO>&to=<ISO>&timezone=<IANA>&group_by=project` | Summary, grouped breakdown, and daily trend; optional `project`, `task_id`, `include_children`, `tag_id`, `status`, and `q` filters |
| `PATCH` | `/api/entries/{id}` | Update project, task, or description on any entry; completed entries also support start/end changes that recalculate duration |
| `DELETE` | `/api/entries/{id}` | Delete an entry; deleting a running or paused entry removes its active timer |
| `GET` | `/api/timeline?from=<ISO>&to=<ISO>` | Entries overlapping a period of up to 32 days; returns `entries`, `count`, and `truncated` (500 entry limit) |
| `GET` | `/api/catalog` | Managed projects, tasks (including `parent_task_id`, `issue_type`, and `jira_site_url`), tags, and direct task time totals |
| `POST` | `/api/catalog` | Create `{ "kind": "project" | "task" | "tag", "name": "...", ... }`; tasks may include `parent_task_id` and `issue_type` |
| `POST` | `/api/catalog/import` | Add managed projects and tasks from the user's existing entries without changing those entries |
| `PATCH` | `/api/catalog/{projects|tasks|tags}/{id}` | Rename or change color; archive/restore projects and tasks; reparent or change task type |
| `POST` | `/api/catalog/jira` | Sync a Jira issue ancestry chain and its `site_url`; the Forge resolver uses the user's personal token |
| `DELETE` | `/api/catalog/{projects|tasks|tags}/{id}` | Archive a project/task or permanently delete a tag |
| `GET` | `/api/entry-tags?ids=<comma-separated-entry-ids>` | Tag IDs assigned to the requested entries |
| `PUT` | `/api/entry-tags` | Replace an entry's tags with `{ "entry_id": "...", "tag_ids": ["..."] }` |
| `GET`, `PUT`, `DELETE` | `/api/calendar/settings` | Read, save, or disconnect the signed-in user's Apps Script URL and shared secret; GET never returns the secret |
| `GET`, `POST` | `/api/calendar/sync` | Read failed or pending deliveries; retry up to five |
| `POST` | `/api/google/connect` | Begin Google OAuth for the signed-in user |
| `GET` | `/api/google/callback` | Complete Google OAuth redirect |
| `GET`, `PATCH`, `DELETE` | `/api/google/settings` | Read, choose an owned calendar, or disconnect the direct connection |
| `GET`, `POST` | `/api/google/calendars` | List owned Google Calendars or create and select a secondary calendar with `{ "name": "Timelogger" }` |
| `GET`, `POST` | `/api/google/sync` | Read or retry direct Calendar deliveries |
| `GET` | `/api/google/links?ids=<entry-ids>` | Read direct Calendar event links for owned entries |

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
