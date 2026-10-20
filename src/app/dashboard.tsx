'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import type { Session } from '@supabase/supabase-js';
import {
  Alert, AppBar, Box, Button, Card, CardContent, Chip, CircularProgress,
  Container, Divider, Grid, Paper, Stack, TextField, Toolbar,
  Typography,
} from '@mui/material';
import { browserClient, type TimeEntry } from '@/lib/supabase';

type ApiTokenRecord = {
  id: string;
  name: string;
  created_at: string;
  expires_at: string;
  last_used_at: string | null;
};

function duration(seconds: number) {
  const whole = Math.max(0, Math.floor(seconds));
  return [Math.floor(whole / 3600), Math.floor((whole % 3600) / 60), whole % 60]
    .map((part) => String(part).padStart(2, '0')).join(':');
}

function currentDuration(entry: TimeEntry, now: number) {
  return entry.elapsed_seconds + (entry.status === 'running' && entry.last_resumed_at
    ? Math.max(0, (now - new Date(entry.last_resumed_at).getTime()) / 1000) : 0);
}

function dateTimeLocal(date: Date) {
  const offset = date.getTimezoneOffset() * 60000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 16);
}

export default function Dashboard({ supabaseUrl, supabaseAnonKey }: { supabaseUrl: string; supabaseAnonKey: string }) {
  const supabase = useMemo(() => browserClient(supabaseUrl, supabaseAnonKey), [supabaseUrl, supabaseAnonKey]);
  const [session, setSession] = useState<Session | null>(null);
  const [ready, setReady] = useState(false);
  const [mode, setMode] = useState<'login' | 'signup'>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [project, setProject] = useState('');
  const [task, setTask] = useState('');
  const [description, setDescription] = useState('');
  const [entry, setEntry] = useState<TimeEntry | null>(null);
  const [entries, setEntries] = useState<TimeEntry[]>([]);
  const [apiTokens, setApiTokens] = useState<ApiTokenRecord[]>([]);
  const [tokenName, setTokenName] = useState('Jira');
  const [newToken, setNewToken] = useState('');
  const [manualStart, setManualStart] = useState(() => dateTimeLocal(new Date(Date.now() - 3600000)));
  const [manualEnd, setManualEnd] = useState(() => dateTimeLocal(new Date()));
  const [manualProject, setManualProject] = useState('');
  const [manualTask, setManualTask] = useState('');
  const [manualDescription, setManualDescription] = useState('');
  const [now, setNow] = useState(Date.now());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => { setSession(data.session); setReady(true); });
    const { data: listener } = supabase.auth.onAuthStateChange((_event, next) => setSession(next));
    return () => listener.subscription.unsubscribe();
  }, [supabase]);

  const request = useCallback(async (path: string, init?: RequestInit) => {
    const { data } = await supabase.auth.getSession();
    if (!data.session) throw new Error('Please sign in again');
    const response = await fetch(path, {
      ...init,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${data.session.access_token}`, ...init?.headers },
      cache: 'no-store',
    });
    const body = await response.json();
    if (!response.ok) throw new Error(body.error || 'Request failed');
    return body;
  }, [supabase]);

  const refresh = useCallback(async () => {
    if (!session) return;
    try {
      const [timerData, entriesData] = await Promise.all([request('/api/timer'), request('/api/entries')]);
      setEntry(timerData.entry);
      setEntries(entriesData.entries);
    } catch (caught) { setError(caught instanceof Error ? caught.message : 'Could not load entries'); }
  }, [request, session]);

  const refreshTokens = useCallback(async () => {
    if (!session) return;
    try {
      const data = await request('/api/tokens');
      setApiTokens(data.tokens);
    } catch (caught) { setError(caught instanceof Error ? caught.message : 'Could not load API tokens'); }
  }, [request, session]);

  useEffect(() => {
    if (!session) { setEntry(null); setEntries([]); setApiTokens([]); setNewToken(''); return; }
    void refresh();
    void refreshTokens();
    const ticker = window.setInterval(() => setNow(Date.now()), 1000);
    const sync = window.setInterval(() => void refresh(), 30000);
    const onFocus = () => void refresh();
    window.addEventListener('focus', onFocus);
    return () => { window.clearInterval(ticker); window.clearInterval(sync); window.removeEventListener('focus', onFocus); };
  }, [session, refresh, refreshTokens]);

  async function createToken(event: React.FormEvent) {
    event.preventDefault(); setBusy(true); setError(''); setNewToken('');
    try {
      const data = await request('/api/tokens', { method: 'POST', body: JSON.stringify({ name: tokenName }) });
      setNewToken(data.token);
      await refreshTokens();
    } catch (caught) { setError(caught instanceof Error ? caught.message : 'Could not create API token'); }
    finally { setBusy(false); }
  }

  async function revokeToken(id: string) {
    setBusy(true); setError('');
    try {
      await request(`/api/tokens/${id}`, { method: 'DELETE' });
      await refreshTokens();
      setNotice('API token revoked');
    } catch (caught) { setError(caught instanceof Error ? caught.message : 'Could not revoke API token'); }
    finally { setBusy(false); }
  }

  async function authenticate(event: React.FormEvent) {
    event.preventDefault(); setBusy(true); setError(''); setNotice('');
    try {
      if (mode === 'login') {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
      } else {
        const { data, error } = await supabase.auth.signUp({ email, password });
        if (error) throw error;
        if (!data.session) setNotice('Account created. Check your email to confirm it, then sign in.');
      }
    } catch (caught) { setError(caught instanceof Error ? caught.message : 'Authentication failed'); }
    finally { setBusy(false); }
  }

  async function timerAction(action: 'start' | 'pause' | 'resume' | 'stop') {
    setBusy(true); setError(''); setNotice('');
    try {
      const body = action === 'start' ? { action, project, task, description } : { action };
      await request('/api/timer', { method: 'POST', body: JSON.stringify(body) });
      await refresh();
    } catch (caught) { setError(caught instanceof Error ? caught.message : 'Timer action failed'); }
    finally { setBusy(false); }
  }

  async function createManual(event: React.FormEvent) {
    event.preventDefault(); setBusy(true); setError(''); setNotice('');
    try {
      await request('/api/entries', { method: 'POST', body: JSON.stringify({
        project: manualProject, task: manualTask, description: manualDescription,
        start_at: new Date(manualStart).toISOString(), end_at: new Date(manualEnd).toISOString(),
      }) });
      setNotice('Time entry added');
      setManualDescription('');
      await refresh();
    } catch (caught) { setError(caught instanceof Error ? caught.message : 'Could not add entry'); }
    finally { setBusy(false); }
  }

  if (!ready) return <Box sx={{ minHeight: '100vh', display: 'grid', placeItems: 'center' }}><CircularProgress /></Box>;

  if (!session) return <Box sx={{ minHeight: '100vh', display: 'grid', placeItems: 'center', bgcolor: '#f4f6f9', p: 2 }}>
    <Card sx={{ width: '100%', maxWidth: 440, borderRadius: 3, boxShadow: 3 }}><CardContent sx={{ p: 4 }}>
      <Stack spacing={3}>
        <Box><Typography variant="h4" sx={{ fontWeight: 700 }}>Timelogger</Typography><Typography color="text.secondary">Your time, clearly accounted for.</Typography></Box>
        <Typography variant="h6">{mode === 'login' ? 'Sign in' : 'Create an account'}</Typography>
        {error && <Alert severity="error">{error}</Alert>}
        {notice && <Alert severity="success">{notice}</Alert>}
        <Box component="form" onSubmit={authenticate}><Stack spacing={2}>
          <TextField label="Email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required fullWidth autoComplete="email" />
          <TextField label="Password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} required fullWidth autoComplete={mode === 'login' ? 'current-password' : 'new-password'} slotProps={{ htmlInput: { minLength: 6 } }} />
          <Button variant="contained" size="large" type="submit" disabled={busy}>{mode === 'login' ? 'Sign in' : 'Sign up'}</Button>
        </Stack></Box>
        <Button onClick={() => { setMode(mode === 'login' ? 'signup' : 'login'); setError(''); setNotice(''); }}>
          {mode === 'login' ? 'Need an account? Sign up' : 'Already have an account? Sign in'}
        </Button>
      </Stack>
    </CardContent></Card>
  </Box>;

  return <Box sx={{ minHeight: '100vh', bgcolor: '#f4f6f9' }}>
    <AppBar position="static" elevation={0}><Toolbar><Typography variant="h6" sx={{ flexGrow: 1, fontWeight: 700 }}>Timelogger</Typography><Typography variant="body2" sx={{ display: { xs: 'none', sm: 'block' }, mr: 2 }}>{session.user.email}</Typography><Button color="inherit" onClick={() => void supabase.auth.signOut()}>Sign out</Button></Toolbar></AppBar>
    <Container maxWidth="lg" sx={{ py: 4 }}><Stack spacing={3}>
      <Box><Typography variant="h4" sx={{ fontWeight: 700 }}>Track your time</Typography><Typography color="text.secondary">Start a timer or add an entry for work already done.</Typography></Box>
      {error && <Alert severity="error" onClose={() => setError('')}>{error}</Alert>}
      {notice && <Alert severity="success" onClose={() => setNotice('')}>{notice}</Alert>}
      <Grid container spacing={3}>
        <Grid size={{ xs: 12, md: 7 }}><Card sx={{ height: '100%', borderRadius: 3 }}><CardContent sx={{ p: 3 }}><Stack spacing={3}>
          <Box><Typography variant="h6" sx={{ fontWeight: 700 }}>Timer</Typography><Typography color="text.secondary">Keeps counting even when this page is closed.</Typography></Box>
          <Typography variant="h2" sx={{ fontWeight: 700, fontVariantNumeric: 'tabular-nums', letterSpacing: -2 }}>{entry ? duration(currentDuration(entry, now)) : '00:00:00'}</Typography>
          {entry && <Chip label={entry.status === 'running' ? 'Running' : 'Paused'} color={entry.status === 'running' ? 'success' : 'warning'} sx={{ alignSelf: 'flex-start' }} />}
          <TextField label="Project" value={entry ? entry.project : project} onChange={(e) => setProject(e.target.value)} disabled={!!entry} fullWidth slotProps={{ htmlInput: { maxLength: 500 } }} />
          <TextField label="Task" value={entry ? entry.task : task} onChange={(e) => setTask(e.target.value)} disabled={!!entry} fullWidth slotProps={{ htmlInput: { maxLength: 500 } }} />
          <TextField label="Description" value={entry ? entry.description : description} onChange={(e) => setDescription(e.target.value)} disabled={!!entry} fullWidth multiline minRows={2} slotProps={{ htmlInput: { maxLength: 500 } }} />
          <Stack direction="row" spacing={1} sx={{ flexWrap: 'wrap', gap: 1 }}>
            {!entry && <Button variant="contained" size="large" disabled={busy} onClick={() => void timerAction('start')}>Start</Button>}
            {entry?.status === 'running' && <Button variant="contained" size="large" color="warning" disabled={busy} onClick={() => void timerAction('pause')}>Pause</Button>}
            {entry?.status === 'paused' && <Button variant="contained" size="large" disabled={busy} onClick={() => void timerAction('resume')}>Resume</Button>}
            {entry && <Button variant="outlined" size="large" color="error" disabled={busy} onClick={() => void timerAction('stop')}>Stop</Button>}
          </Stack>
        </Stack></CardContent></Card></Grid>
        <Grid size={{ xs: 12, md: 5 }}><Card sx={{ height: '100%', borderRadius: 3 }}><CardContent sx={{ p: 3 }}><Stack spacing={2}>
          <Box><Typography variant="h6" sx={{ fontWeight: 700 }}>Add time manually</Typography><Typography color="text.secondary">Record a completed work period.</Typography></Box>
          <Box component="form" onSubmit={createManual}><Stack spacing={2}>
            <TextField label="Project" value={manualProject} onChange={(e) => setManualProject(e.target.value)} fullWidth slotProps={{ htmlInput: { maxLength: 500 } }} />
            <TextField label="Task" value={manualTask} onChange={(e) => setManualTask(e.target.value)} fullWidth slotProps={{ htmlInput: { maxLength: 500 } }} />
            <TextField label="Description" value={manualDescription} onChange={(e) => setManualDescription(e.target.value)} fullWidth multiline minRows={2} slotProps={{ htmlInput: { maxLength: 500 } }} />
            <TextField label="Start" type="datetime-local" value={manualStart} onChange={(e) => setManualStart(e.target.value)} slotProps={{ inputLabel: { shrink: true } }} required fullWidth />
            <TextField label="End" type="datetime-local" value={manualEnd} onChange={(e) => setManualEnd(e.target.value)} slotProps={{ inputLabel: { shrink: true } }} required fullWidth />
            <Button type="submit" variant="outlined" disabled={busy}>Add entry</Button>
          </Stack></Box>
        </Stack></CardContent></Card></Grid>
      </Grid>
      <Paper sx={{ borderRadius: 3, p: 3 }}><Stack spacing={2}>
        <Typography variant="h6" sx={{ fontWeight: 700 }}>Recent entries</Typography>
        {entries.length === 0 && <Typography color="text.secondary">No entries yet. Start your first timer.</Typography>}
        {entries.map((item, index) => <Box key={item.id}><Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} sx={{ justifyContent: 'space-between', alignItems: { sm: 'center' } }}>
          <Box><Typography sx={{ fontWeight: 600 }}>{item.task || item.description || 'Untitled work'}</Typography><Typography variant="body2" color="text.secondary">{item.project || 'No project'} · {new Date(item.start_at).toLocaleString()}{item.end_at ? ` – ${new Date(item.end_at).toLocaleTimeString()}` : ''}</Typography>{item.task && item.description && <Typography variant="body2" color="text.secondary">{item.description}</Typography>}</Box>
          <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}><Typography sx={{ fontVariantNumeric: 'tabular-nums', fontWeight: 600 }}>{duration(currentDuration(item, now))}</Typography><Chip size="small" label={item.status} /></Stack>
        </Stack>{index < entries.length - 1 && <Divider sx={{ mt: 2 }} />}</Box>)}
      </Stack></Paper>
      <Paper sx={{ borderRadius: 3, p: 3 }}><Stack spacing={2}>
        <Box><Typography variant="h6" sx={{ fontWeight: 700 }}>Settings · API tokens</Typography><Typography color="text.secondary">Create a token for the Jira app. Each token expires after 90 days and can be revoked here.</Typography></Box>
        <Box component="form" onSubmit={createToken}><Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
          <TextField label="Token name" value={tokenName} onChange={(e) => setTokenName(e.target.value)} required slotProps={{ htmlInput: { maxLength: 80 } }} sx={{ minWidth: 240 }} />
          <Button type="submit" variant="contained" disabled={busy}>Create API token</Button>
        </Stack></Box>
        {newToken && <Alert severity="success" action={<Button color="inherit" size="small" onClick={() => void navigator.clipboard.writeText(newToken)}>Copy</Button>}>
          <Typography sx={{ fontWeight: 600 }}>Copy this token now. It will not be shown again.</Typography>
          <Typography component="code" sx={{ display: 'block', overflowWrap: 'anywhere', userSelect: 'all' }}>{newToken}</Typography>
        </Alert>}
        {apiTokens.length === 0 && <Typography color="text.secondary">No API tokens yet.</Typography>}
        {apiTokens.map((token) => <Stack key={token.id} direction={{ xs: 'column', sm: 'row' }} spacing={1} sx={{ justifyContent: 'space-between', alignItems: { sm: 'center' } }}>
          <Box><Typography sx={{ fontWeight: 600 }}>{token.name}</Typography><Typography variant="body2" color="text.secondary">Expires {new Date(token.expires_at).toLocaleDateString()} · {token.last_used_at ? `Last used ${new Date(token.last_used_at).toLocaleString()}` : 'Never used'}</Typography></Box>
          <Button color="error" disabled={busy} onClick={() => void revokeToken(token.id)}>Revoke</Button>
        </Stack>)}
      </Stack></Paper>
    </Stack></Container>
  </Box>;
}
