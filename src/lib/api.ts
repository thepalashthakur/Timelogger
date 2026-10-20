import { NextRequest, NextResponse } from 'next/server';
import { tokenClient } from './supabase';

export async function authenticated(req: NextRequest) {
  const match = /^Bearer\s+(.+)$/i.exec(req.headers.get('authorization') ?? '');
  if (!match) return null;
  const client = tokenClient(match[1]);
  const { data, error } = await client.auth.getUser(match[1]);
  return error || !data.user ? null : { client, user: data.user };
}

export const unauthorized = () => NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
export const badRequest = (error: string) => NextResponse.json({ error }, { status: 400 });

export function details(value: unknown) {
  if (!value || typeof value !== 'object') return null;
  const input = value as Record<string, unknown>;
  const fields = ['project', 'task', 'description'] as const;
  for (const field of fields) {
    if (input[field] !== undefined && (typeof input[field] !== 'string' || (input[field] as string).length > 500)) return null;
  }
  return {
    project: typeof input.project === 'string' ? input.project.trim() : '',
    task: typeof input.task === 'string' ? input.task.trim() : '',
    description: typeof input.description === 'string' ? input.description.trim() : '',
  };
}
