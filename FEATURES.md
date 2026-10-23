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

## v1 — custom time entry properties

| Feature | Status |
| --- | --- |
| User defined property definitions and types | Planned |
| Set and edit custom values per entry | Planned |
| Filter entries by custom properties | Planned |
| API and database support for custom properties | Planned |

## Later Toggl style features

Reports, team workspaces, billable rates, exports, and additional integrations are future candidates. Scope and order will be decided after v1.
