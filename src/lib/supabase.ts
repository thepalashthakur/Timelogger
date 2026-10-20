import { createClient } from '@supabase/supabase-js';

export function config() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_ANON_KEY;
  if (!url || !key) throw new Error('Supabase environment variables are missing');
  return { url, key };
}

export function browserClient(url: string, key: string) {
  return createClient(url, key);
}

export function tokenClient(token: string) {
  const { url, key } = config();
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { headers: { Authorization: `Bearer ${token}` } },
  });
}

export type TimeEntry = {
  id: string;
  user_id: string;
  project: string;
  task: string;
  description: string;
  status: 'running' | 'paused' | 'stopped';
  start_at: string;
  end_at: string | null;
  last_resumed_at: string | null;
  elapsed_seconds: number;
  created_at: string;
};
