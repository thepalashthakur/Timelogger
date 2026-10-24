# Analytics scope and roadmap

## v0.13 implemented

The **Analytics** tab provides a personal summary report based on Timelogger time entries. It has Today, This week, This month, Last 30 days, and custom date ranges (up to 366 days); project, task subtree, tag, timer status, and entry-text filters; and grouping by project, full task path, top-level task, tag, day, or week. MUI X Charts supplies bar, donut, and daily trend views. KPI cards show tracked time, entry count, average per calendar day, and busiest day. The breakdown table opens a group's five most recent entries, which link to the existing entry details dialog.

The report API is authenticated and user-scoped. It pages through matching entries rather than silently relying on Supabase's default row limit. A report with over 20,000 entries returns a clear error asking the user to narrow the range. The breakdown displays the top 500 groups and says when more groups exist. No database migration is needed.

Each entry is selected and assigned to a day by its **start time** in the viewer's time zone. The entry's full tracked duration belongs to that day, including when it crosses midnight. Running timers include elapsed time at the moment the report loads; refresh to update them. If an entry has multiple tags, each tag group includes its duration, while KPI totals count the entry once.

## Why this scope

- [Toggl Track's Summary Report](https://support.toggl.com/en-us/article/summary-report-1emjk2m/) combines filters, bar and pie views, a grouping breakdown, and exports. Its [filter guide](https://support.toggl.com/en-us/article/using-filters-in-toggl-track-reports-18575d8/) includes project, task, tag, description, and dates.
- [Clockify's Summary Report](https://clockify.me/help/reports/summary-report) groups tracked time by project, tag, and date, combines bar and pie charts, and links summary rows to details. Its [filter guide](https://clockify.me/help/reports/filtering-reports) supports multiple grouping levels.

Timelogger already stores projects, nested tasks, tags, and entry times, so those dimensions are useful immediately. Client, team, billable, cost, and profit controls would be misleading until the underlying records exist.

## Future scope

| Feature | Why it matters / prerequisite |
| --- | --- |
| Full, paginated drilldown from any group to all matching entries | The current group panel shows its five most recent entries. A detailed report should navigate the complete set, including nested-task and tag groups. |
| Secondary and tertiary grouping | Enables project → epic → task and project → tag breakdowns like mature trackers. |
| CSV and PDF exports, saved report presets, shareable links | Useful for recurring reviews and clients; requires durable report settings and export limits. |
| Period comparison, targets, and utilization | Adds week-over-week trends and planned-versus-tracked context. |
| Billable rates, clients, team members, costs, and revenue | Depends on those dimensions being modeled in Timelogger first. |
| Exact daily allocation for entries crossing midnight and paused timers | Requires persisted work segments or a defined allocation rule; the current schema stores total elapsed seconds, not every pause interval. |
| Server-side SQL aggregation for very large accounts | Removes the 20,000-entry processing limit while keeping reports fast. Any migration must remain additive and use `timelogger_`-prefixed objects. |
| Scheduled reports and Jira/Todoist metadata filters | Requires connector sync and notification delivery. |
