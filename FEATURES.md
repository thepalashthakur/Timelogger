# Feature roadmap

Status reflects code in this repository. The web app and Jira Forge app are deployed separately.

## v0 — initial release

| Feature | Status |
| --- | --- |
| Email and password sign up, login, logout | Implemented |
| Start, pause, resume, and stop one timer per user | Implemented |
| Timer continues while the browser is closed | Implemented |
| Authenticated API for timer actions | Implemented |
| Project, task, and description on time entries | Implemented |
| Manual time entry creation and entry history | Implemented |
| Additive, prefixed Supabase schema and row level security | Implemented |
| MUI user interface | Implemented |

## v0.1 — Jira integration groundwork

| Feature | Status |
| --- | --- |
| Create and revoke personal API tokens in settings | Implemented |
| One-time token display, 90-day expiry, hashed storage | Implemented |
| Use a personal token with timer and entry APIs | Implemented |
| Native Jira issue panel and account linking | Implemented |
| Start, pause, resume, and stop Timelogger timer from a Jira issue | Implemented |

## v0.2 — navigation and time entry discovery

| Feature | Status |
| --- | --- |
| Dedicated Timer, Time entries, and Settings views with URL hash navigation | Implemented |
| Responsive entry table and mobile list | Implemented |
| Search across project, task, and description | Implemented |
| Filter by project, status, and start date range | Implemented |
| Server-side pagination and result count across full entry history | Implemented |
| Manual entry flow opens the entries view after saving | Implemented |

## v0.3 — dashboard timeline

| Feature | Status |
| --- | --- |
| Dashboard with compact timer controls and manual entry dialog | Implemented |
| Weekly and daily hourly timeline with previous, next, and today navigation | Implemented |
| Entry details on timeline blocks and current time indicator | Implemented |
| Authenticated timeline API with entries overlapping the selected period | Implemented |
| Responsive horizontal scrolling for the weekly calendar | Implemented |

Release versioning: new feature releases increase the minor version by `0.1` (for example, `0.2.0` to `0.3.0`). Dashboard bug fixes increase the patch by `0.0.1` (for example, `0.3.0` to `0.3.1`).

### v0.3.1 — dashboard build fix

The Next.js TypeScript project now checks only web app source and generated Next.js types. The Forge frontend keeps its own TypeScript config and dependencies, so Vercel can build the web app without installing Forge packages.

## v0.4 — time entry CRUD

| Feature | Status |
| --- | --- |
| Create completed entries from Dashboard and Time entries | Implemented |
| Read entries through the timeline and searchable history | Implemented |
| Edit project, task, description, start, and end for completed entries | Implemented |
| Delete completed entries with confirmation | Implemented |
| Authenticated, user-scoped update and delete API | Implemented |

Changing a completed entry's time range recalculates its tracked duration; changing only its text keeps the stored duration. No database migration is required.

### v0.4.1 — entry action visibility

Edit and Delete are visible beside each entry in the web list and in timeline entry details. Running and paused entries support metadata edits; their start and end times stay under timer controls. Deleting an active entry removes its timer after confirmation.

### v0.4.2 — timeline navigation and zoom

The dashboard timeline has a date picker, zoom in and zoom out controls, and an Expand action that shows the full day height without the timeline's usual scroll limit.

## v0.5 — projects, tasks, and tags

| Feature | Status |
| --- | --- |
| Managed projects with stable keys, names, colors, and archive/restore | Implemented |
| Tasks scoped to one project, with stable keys and archive/restore | Implemented |
| Reusable tags with names and colors, assignable to multiple time entries | Implemented |
| Create categories from the dashboard or entry forms and manage them in a dedicated view | Implemented |
| Filter entry history by task and tag | Implemented |
| Import project and task keys from existing entries into managed records | Implemented |
| Jira issue key and project key automatically create matching catalog items on timer start | Implemented |
| Choose Timelogger tags when starting an issue timer in Forge | Implemented |
| Additive `timelogger_` catalog migration without changing existing tables or data | Implemented in `supabase/catalog.sql`; deployment requires applying it |

Project and task keys are immutable so existing time entries and Jira issue links remain stable when display names change. Existing freeform project and task values remain readable; they are not rewritten by the migration. Jira keys remain the stored project and task values for Jira-created entries.

## v0.6 — Google Calendar sync

| Feature | Status |
| --- | --- |
| Per-user Apps Script deployment URL and shared secret in Settings | Implemented |
| Copyable Apps Script compatible with existing Clockify upserts and a chosen Calendar ID | Implemented |
| Create Calendar events for manual entries and stopped timers | Implemented |
| Update and delete Calendar events when completed entries change | Implemented |
| Persistent delivery status and manual retry for failed sync | Implemented |
| Additive `timelogger_` Calendar tables without changing existing tables or data | Implemented in `supabase/calendar_sync.sql` and `supabase/calendar_webhook.sql`; deployment requires applying both |

Calendar sync begins after a user saves their deployed `/exec` URL. Running and paused timers sync when stopped. The Apps Script stores a Timelogger entry ID to Calendar event ID mapping so repeated requests update the same event.

### v0.6.1 — browser tab icon

The browser tab uses the supplied stopwatch image as the app icon.

## v0.7 — MUI date and time pickers

| Feature | Status |
| --- | --- |
| MUI DatePicker and TimePicker for manual entry creation | Implemented |
| MUI DatePicker and TimePicker for completed entry editing | Implemented |
| MUI DatePicker for dashboard timeline navigation | Implemented |
| Validate local date and time selections before saving | Implemented |

The separate date and time values are combined in the user's local time zone before sending ISO timestamps to the API. Editing only entry details does not rewrite existing timestamps.

## v0.8 — direct Google Calendar connector

| Feature | Status |
| --- | --- |
| Per-user Google OAuth connection with encrypted refresh token | Implemented |
| Choose an owned Google Calendar for new time entries | Implemented |
| Create, update, and delete events for completed entries and stopped timers | Implemented |
| Store Google event ID and web link per time entry | Implemented |
| Persistent failed delivery status and manual retry | Implemented |
| Preserve Apps Script sync and keep existing linked entries on that method | Implemented |
| Additive `timelogger_` database migration | Implemented in `supabase/google_calendar.sql`; deployment requires applying it |

Direct Google Calendar requires a Google Cloud OAuth client, Calendar API, registered redirect URI, and four server-side environment variables. Google edits do not sync back to Timelogger. Existing Calendar events are not imported automatically.

## v0.9 — create Google calendars

| Feature | Status |
| --- | --- |
| Create a secondary Google Calendar from Settings | Implemented |
| Select the new calendar for future time entries | Implemented |
| Request Google calendar creation permission during OAuth | Implemented |
| Keep existing synced events on their original calendars | Implemented |

Users connected before v0.9 must reconnect once to grant the new `calendar.calendars` permission. No database migration is needed beyond the v0.8 direct connector migration.

## v0.10 — password recovery and change

| Feature | Status |
| --- | --- |
| Request a password reset email from the sign-in screen | Implemented |
| Set a new password after opening the Supabase recovery link | Implemented |
| Change password from Settings after verifying the current password | Implemented |
| Support Supabase email reauthentication codes for older sessions | Implemented |

Supabase Auth must have email/password enabled and its Site URL set to the deployed Timelogger address. Password reset emails use the project's configured email sender. No database migration is needed.

## v0.11 — nested tasks and Jira hierarchy

| Feature | Status |
| --- | --- |
| Unlimited-depth parent and child tasks within a project | Implemented |
| MUI tree display, issue type, parent selector, and Add child action | Implemented |
| Direct and descendant tracked-time totals in the task tree | Implemented |
| Cycle, ownership, and cross-project validation in the database | Implemented |
| Forge reads Jira issue type, summary, and ancestry when starting a timer | Implemented |
| Additive `timelogger_` migration; existing entries retain their keys | Implemented |

Release order: apply `supabase/task_hierarchy.sql`, deploy the web app, then deploy Forge and upgrade its Jira installation for the new `read:jira-work` scope. Existing tasks remain roots until arranged manually or revisited from Jira. Jira ancestry is refreshed when a timer is started from its issue panel; broader historical Jira imports and scheduled re-sync are not included in v0.11.

## v0.12 — time entry hierarchy insights

| Feature | Status |
| --- | --- |
| Open the same details dialog from timeline, active timer, and desktop/mobile history | Implemented |
| Show clickable project → parent → child task path for the entry | Implemented |
| Browse parent and child tasks inside the entry dialog | Implemented |
| Show task type, stable key, archived/Jira source, direct time, and descendant time | Implemented |
| Keep entry duration, status, description, tags, times, and Calendar link together | Implemented |
| Handle entries without a catalog task and cyclic or missing parent metadata gracefully | Implemented |

The entry still stores its stable project and task keys. The dialog resolves those keys against the retained catalog hierarchy, including archived tasks. No database migration is required.

## v0.13 — personal analytics

| Feature | Status |
| --- | --- |
| Analytics tab with period, project, nested task, tag, status, and search filters | Implemented |
| Group by project, full task path, top-level task, tag, day, or week | Implemented |
| MUI bar, donut, and daily trend charts | Implemented |
| Tracked time, entry count, daily average, and busiest day cards | Implemented |
| Breakdown table with recent-entry drilldown to entry details | Implemented |
| Authenticated report API with explicit large-result limits | Implemented |

See [ANALYTICS.md](ANALYTICS.md) for report semantics, similar-app research, and future analytics scope. No migration is required.

## v0.14 — appearance and dark mode

| Feature | Status |
| --- | --- |
| Light and dark MUI color schemes with system preference as the default | Implemented |
| Appearance choice in the header, Settings, sign-in, and password recovery | Implemented |
| Save appearance choice in this browser and sync it between tabs | Implemented |
| Theme-aware pages, timeline, forms, dialogs, and charts | Implemented |
| Contrast-aware text on user-colored tags | Implemented |

The selected appearance is a browser preference and does not require a database migration.

## v0.15 — sidebar and profile

| Feature | Status |
| --- | --- |
| Sidebar navigation for Dashboard, Time entries, Analytics, Projects & tags, Profile, and Settings | Implemented |
| Mobile menu drawer with the same navigation and preserved URL hash links | Implemented |
| Profile page with display name, email, verification status, and membership date | Implemented |
| Edit display name through Supabase Auth user metadata | Implemented |

The profile uses the existing Supabase Auth user record. No database migration is required.

### v0.15.1 — conditional password reauthentication

The signed-in password form shows no email-code action by default. If Supabase returns `reauthentication_needed` for the current session, the form reveals Send verification code and accepts the emailed code for the retry. No database migration is required.

## v0.16 — links back to Jira issues

| Feature | Status |
| --- | --- |
| Forge reads the installed Jira site's base URL when syncing an issue hierarchy | Implemented |
| Save each imported issue's site in a new user-scoped `timelogger_jira_task_links` table | Implemented in `supabase/jira_task_links.sql`; deployment requires applying it |
| Show an Open in Jira chip on linked tasks in the catalog and entry details | Implemented |
| Open the issue in a separate browser tab with validated HTTPS Jira URLs | Implemented |
| Preserve Jira source metadata when editing an imported task in Timelogger | Implemented |

Apply the migration, deploy the web app, then deploy Forge. Existing Jira-sourced tasks get links when their issues are synced again by starting a timer from the Jira panel. Manually created child tasks remain local to Timelogger and have no Jira link.

### v0.16.1 — simplified top bar

The signed-in top bar now shows only the app name and mobile menu. Email and Sign out are in the sidebar; Appearance remains in Settings. No migration is required.

## v1 — custom time entry properties

| Feature | Status |
| --- | --- |
| User defined property definitions and types | Planned |
| Set and edit custom values per entry | Planned |
| Filter entries by custom properties | Planned |
| API and database support for custom properties | Planned |

## Later Toggl style features

Reports, team workspaces, billable rates, exports, and additional integrations are future candidates. Scope and order will be decided after v1.
