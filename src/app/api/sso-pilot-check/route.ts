import { browserSsoSession, validateAccess } from '@/lib/sso';
import { hasSessionAppAccess } from '@/lib/app-access';

export const dynamic = 'force-dynamic';

export async function GET() {
  if (process.env.VERCEL_ENV !== 'preview') return new Response(null, { status: 404 });
  const session = await browserSsoSession();
  if (!session) return Response.json({ error: 'No SSO session' }, { status: 401 });
  try {
    if (await validateAccess(session.accessToken) !== session.subject || !await hasSessionAppAccess(session.accessToken)) {
      return Response.json({ error: 'No Time Logger access' }, { status: 401 });
    }
    const provider = process.env.SUPABASE_URL;
    const key = process.env.SUPABASE_ANON_KEY;
    if (!provider || !key) return new Response(null, { status: 503 });
    const headers = { apikey: key, Authorization: `Bearer ${session.accessToken}` };
    const rows = async (table: string) => {
      const response = await fetch(`${provider}/rest/v1/${table}?select=id&limit=1`, { headers, cache: 'no-store' });
      const body = await response.json().catch(() => null);
      return { status: response.status, hasRow: Array.isArray(body) && body.length > 0 };
    };
    const rpc = async (name: string, body: object) => {
      const response = await fetch(`${provider}/rest/v1/rpc/${name}`, {
        method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' }, body: JSON.stringify(body), cache: 'no-store',
      });
      const result = await response.json().catch(() => null) as { code?: string } | boolean | null;
      return { status: response.status, value: typeof result === 'boolean' ? result : undefined, code: result && typeof result === 'object' ? result.code : undefined };
    };
    const [timeEntry, habit, ownAccess, otherAccess, otherGuard] = await Promise.all([
      rows('timelogger_time_entries'), rows('tracker_habits'),
      rpc('has_app_access', { app_key: 'timelogger' }), rpc('has_app_access', { app_key: 'myhabits' }),
      rpc('require_myhabits_access', {}),
    ]);
    return Response.json({ timeEntry, habit, ownAccess, otherAccess, otherGuard }, { headers: { 'Cache-Control': 'private, no-store' } });
  } catch {
    return Response.json({ error: 'Probe failed' }, { status: 503 });
  }
}
