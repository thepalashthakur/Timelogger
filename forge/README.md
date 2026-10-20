# Timelogger for Jira Cloud

This Forge app adds a Timelogger panel to Jira issues. Each Jira user connects their own Timelogger personal API token. The Forge resolver stores that token with `kvs.setSecret`, then calls the Timelogger API on the user's behalf. The token is never returned to Custom UI.

Starting a timer uses the Jira issue key as `task` and the key prefix as `project`. The panel can pause, resume, and stop the active timer and shows the five most recent entries for the issue. Timelogger remains the source of time entries; this version does not create Jira worklogs.

## Prerequisites

- A deployed HTTPS Timelogger app with `SUPABASE_URL`, `SUPABASE_ANON_KEY`, and server-only `SUPABASE_SERVICE_ROLE_KEY` configured, and both SQL migrations applied.
- Node.js. The [Forge CLI](https://developer.atlassian.com/platform/forge/getting-started/) is installed locally by `npm install`.
- A Jira Cloud site where you can install Forge apps.

## Register and install

From this `forge` directory:

```sh
npm install
npm --prefix static install
npm run build
npx forge login
export TIMELOGGER_API_ORIGIN=https://your-timelogger-domain.example
npx forge register
npx forge variables set TIMELOGGER_API_ORIGIN "$TIMELOGGER_API_ORIGIN"
npx forge deploy
npx forge install --site your-site.atlassian.net --product Jira
```

Set `TIMELOGGER_API_ORIGIN` to the exact HTTPS origin, without a path or trailing slash. Forge uses the shell variable to expand the manifest egress permission and its runtime variable for API requests. `forge register` replaces the placeholder `app.id` in `manifest.yml`. The Jira site administrator must approve the requested storage and outbound fetch permissions. After changing the origin, rebuild and redeploy; reinstall or upgrade the app if Forge asks for permission approval.

In Timelogger, sign in and create a token under Settings. Open a Jira issue, expand the Timelogger panel, and connect the token. Tokens expire after 90 days or when revoked in Timelogger; reconnect with a new token when needed. Disconnect deletes the Forge secret for that Jira account.

## Local verification

`npm run build` builds the Custom UI into `static/dist`. `npx forge lint` validates the manifest and resolver. Test the complete flow on a Jira Cloud site after installation: connect, start, pause, resume, stop, and confirm entries in Timelogger.
