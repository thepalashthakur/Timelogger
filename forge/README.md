# Timelogger for Jira Cloud

This Forge app adds a Timelogger panel to Jira issues. Each Jira user connects their own Timelogger personal API token. The Forge resolver stores that token with `kvs.setSecret`, then calls the Timelogger API on the user's behalf. The token is never returned to Custom UI.

Starting a timer uses the Jira issue key as `task` and the key prefix as `project`. Timelogger creates matching managed project and task records when the catalog migration is installed, while retaining the Jira keys on entries. The panel can apply existing Timelogger tags, pause, resume, and stop the active timer, and shows the five most recent entries for the issue. Timelogger remains the source of time entries; this version does not create Jira worklogs.

## Prerequisites

- A deployed HTTPS Timelogger app with `SUPABASE_URL`, `SUPABASE_ANON_KEY`, and server-only `SUPABASE_SERVICE_ROLE_KEY` configured, and all three SQL migrations applied.
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
npx forge deploy --environment development
```

The app ID in `manifest.yml` is already registered, so do not run `forge register` for this installation. If Forge requests a permission upgrade, run `npx forge install --upgrade --site projects-1.atlassian.net --product Jira --environment development` and approve it as a Jira site administrator. A first installation on another Jira site uses `npx forge install --site <site>.atlassian.net --product Jira --environment development` after deployment.

The manifest allows outbound requests to the deployed Timelogger origin. The `TIMELOGGER_API_ORIGIN` runtime variable tells the resolver where to send them. For a new Forge environment, set it before deploying: `npx forge variables set --environment development TIMELOGGER_API_ORIGIN https://timelogger-gilt.vercel.app`. After changing the origin, update both the manifest and runtime variable, then redeploy. Forge variables are scoped to their environment and take effect after deployment.

The `FORGE_TOKEN` value in the repository's `.env` is an Atlassian CLI token. The CLI does not automatically load `.env`; run `npx forge login` and enter your Atlassian email and token, or export them as `FORGE_EMAIL` and `FORGE_API_TOKEN` before running commands. The Timelogger personal token is a separate token created in Timelogger Settings and pasted into the Jira issue panel.

In Timelogger, sign in and create a token under Settings. Open a Jira issue, expand the Timelogger panel, and connect the token. Tokens expire after 90 days or when revoked in Timelogger; reconnect with a new token when needed. Disconnect deletes the Forge secret for that Jira account.

## Local verification

`npm run build` builds the Custom UI into `static/dist`. `npx forge lint` validates the manifest and resolver. Test the complete flow on a Jira Cloud site after installation: connect, start, pause, resume, stop, and confirm entries in Timelogger.
