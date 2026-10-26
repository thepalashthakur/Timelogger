import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import { adminClient } from './admin';
import { tokenClient } from './supabase';

const appKey = 'timelogger';

export async function hasSessionAppAccess(accessToken: string) {
  const { data, error } = await tokenClient(accessToken).rpc('has_app_access', { app_key: appKey });
  return !error && data === true;
}

export async function hasApiTokenAppAccess(userId: string, client: SupabaseClient = adminClient()) {
  const { data, error } = await client.rpc('has_app_access_for_user', { app_key: appKey, subject_user_id: userId });
  return !error && data === true;
}
