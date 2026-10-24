# Timelogger for Jira Cloud

This Forge app adds a Timelogger panel to Jira issues. Each Jira user connects their own Timelogger personal API token. The Forge resolver stores that token with `kvs.setSecret`, then calls the Timelogger API on the user's behalf. The token is never returned to Custom UI.

Starting a timer uses the Jira issue key as `task` and the key prefix as `project`. The resolver reads the issue's summary, type, parent chain, and site's base URL as the current Jira user and syncs them to Timelogger before starting the timer. Timelogger retains Jira keys on entries and shows Open in Jira chips for linked tasks. The panel can apply existing Timelogger tags, pause, resume, and stop the active timer, and shows the five most recent entries for the issue. Timelogger remains the source of time entries; this version does not create Jira worklogs.

## Prerequisites

- A deployed HTTPS Timelogger app with `SUPABASE_URL`, `SUPABASE_ANON_KEY`, and server-only `SUPABASE_SERVICE_ROLE_KEY` configured. Apply `supabase/task_hierarchy.sql` and `supabase/jira_task_links.sql` before using the v0.16 Jira link feature.
- Node.js. The [Forge CLI](https://developer.atlassian.com/platform/forge/getting-started/) is installed locally by `npm install`.
- A Jira Cloud site where you can install Forge apps.

## Deploy an update to the existing Jira installation

From this `forge` directory:

```sh
npm install
npm --prefix static install
npm run build
npx forge login
npx forge lint
npx forge deploy --environment development --approve MAJOR_VERSION_RULE
npx forge install --upgrade --site projects-1.atlassian.net --product Jira --environment development
```

The app ID in `manifest.yml` is already registered, so do not run `forge register` for this installation. This version requires the `read:jira-work` Jira scope. The `MAJOR_VERSION_RULE` linter approval is expected; `--approve MAJOR_VERSION_RULE` acknowledges the permission change during deployment. The subsequent installation upgrade applies it to the site and may require Jira administrator consent. A first installation on another Jira site uses `npx forge install --site <site>.atlassian.net --product Jira --environment development` after deployment.

The manifest allows outbound requests to the deployed Timelogger origin. The `TIMELOGGER_API_ORIGIN` runtime variable tells the resolver where to send them. For a new Forge environment, set it before deploying: `npx forge variables set --environment development TIMELOGGER_API_ORIGIN https://timelogger-gilt.vercel.app`. After changing the origin, update both the manifest and runtime variable, then redeploy. Forge variables are scoped to their environment and take effect after deployment.

No new Forge scope is needed for issue links. The resolver reads `/rest/api/3/serverInfo`, which returns the installed site's base URL. Jira issues previously imported into Timelogger gain links the next time a timer starts from the issue panel; the synced parent chain gains links at the same time.

The `FORGE_TOKEN` value in the repository's `.env` is an Atlassian CLI token. The CLI does not automatically load `.env`; run `npx forge login` and enter your Atlassian email and token, or export them as `FORGE_EMAIL` and `FORGE_API_TOKEN` before running commands. The Timelogger personal token is a separate token created in Timelogger Settings and pasted into the Jira issue panel.

In Timelogger, sign in and create a token under Settings. Open a Jira issue, expand the Timelogger panel, and connect the token. Tokens expire after 90 days or when revoked in Timelogger; reconnect with a new token when needed. Disconnect deletes the Forge secret for that Jira account.

## Local verification

`npm run build` builds the Custom UI into `static/dist`. `npx forge lint` validates the manifest and resolver. Test the complete flow on a Jira Cloud site after installation: connect, start, pause, resume, stop, and confirm entries in Timelogger.
