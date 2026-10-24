export function jiraIssueUrl(siteUrl: unknown, issueKey: unknown): string | null {
  if (typeof siteUrl !== 'string' || typeof issueKey !== 'string' ||
    !/^[A-Z][A-Z0-9_]{0,99}-[0-9]+$/.test(issueKey)) return null;
  try {
    const url = new URL(siteUrl);
    if (url.protocol !== 'https:' || !/^[a-z0-9][a-z0-9-]*\.atlassian\.net$/i.test(url.hostname) ||
      url.port || url.username || url.password || url.pathname !== '/' || url.search || url.hash || url.origin !== siteUrl) return null;
    return `${url.origin}/browse/${issueKey}`;
  } catch {
    return null;
  }
}
