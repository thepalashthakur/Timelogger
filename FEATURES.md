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

## v1 — custom time entry properties

| Feature | Status |
| --- | --- |
| User defined property definitions and types | Planned |
| Set and edit custom values per entry | Planned |
| Filter entries by custom properties | Planned |
| API and database support for custom properties | Planned |

## Later Toggl style features

Projects and tasks as managed records, tags, reports, team workspaces, billable rates, exports, and integrations are future candidates. Scope and order will be decided after v1.
