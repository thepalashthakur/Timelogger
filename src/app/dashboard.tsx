'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Session } from '@supabase/supabase-js';
import {
  Alert, AppBar, Box, Button, Card, CardContent, Chip, CircularProgress,
  Container, Divider, Grid, MenuItem, Pagination, Paper, Stack, Tab, Table,
  TableBody, TableCell, TableContainer, TableHead, TableRow, Tabs, TextField, Toolbar,
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
type View = 'timer' | 'entries' | 'settings';
type StatusFilter = 'all' | TimeEntry['status'];
const pageSize = 20;

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

function dateBoundary(value: string, nextDay = false) {
  const date = new Date(`${value}T00:00:00`);
  if (nextDay) date.setDate(date.getDate() + 1);
  return date.toISOString();
}

export default function Dashboard({ supabaseUrl, supabaseAnonKey }: { supabaseUrl: string; supabaseAnonKey: string }) {
  const supabase = useMemo(() => browserClient(supabaseUrl, supabaseAnonKey), [supabaseUrl, supabaseAnonKey]);
  const [session, setSession] = useState<Session | null>(null);
  const [ready, setReady] = useState(false);
  const [mode, setMode] = useState<'login' | 'signup'>('login');
  const [view, setView] = useState<View>('timer');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [project, setProject] = useState('');
  const [task, setTask] = useState('');
  const [description, setDescription] = useState('');
  const [entry, setEntry] = useState<TimeEntry | null>(null);
  const [entries, setEntries] = useState<TimeEntry[]>([]);
  const [entryCount, setEntryCount] = useState(0);
  const [entriesLoading, setEntriesLoading] = useState(false);
  const [entriesError, setEntriesError] = useState('');
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [projectFilter, setProjectFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');
  const [page, setPage] = useState(1);
  const entryRequestId = useRef(0);
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

  useEffect(() => {
    const syncView = () => {
      const hash = window.location.hash.slice(1);
      if (hash === 'timer' || hash === 'entries' || hash === 'settings') setView(hash);
    };
    syncView();
    window.addEventListener('hashchange', syncView);
    return () => window.removeEventListener('hashchange', syncView);
  }, []);

  useEffect(() => {
    const delay = window.setTimeout(() => {
      if (searchInput.trim() !== search) { setSearch(searchInput.trim()); setPage(1); }
    }, 300);
    return () => window.clearTimeout(delay);
  }, [searchInput, search]);

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

  const refreshTimer = useCallback(async () => {
    if (!session) return;
    try {
      const data = await request('/api/timer');
      setEntry(data.entry);
    } catch (caught) { setError(caught instanceof Error ? caught.message : 'Could not load timer'); }
  }, [request, session]);

  const loadEntries = useCallback(async () => {
    if (!session) return;
    const id = ++entryRequestId.current;
    setEntriesLoading(true);
    setEntriesError('');
    const params = new URLSearchParams({ page: String(page), page_size: String(pageSize) });
    if (search) params.set('q', search);
    if (projectFilter.trim()) params.set('project', projectFilter.trim());
    if (statusFilter !== 'all') params.set('status', statusFilter);
    if (fromDate) params.set('from', dateBoundary(fromDate));
    if (toDate) params.set('to', dateBoundary(toDate, true));
    try {
      const data = await request(`/api/entries?${params}`);
      if (id === entryRequestId.current) { setEntries(data.entries); setEntryCount(data.count); }
    } catch (caught) {
      if (id === entryRequestId.current) setEntriesError(caught instanceof Error ? caught.message : 'Could not load entries');
    } finally {
      if (id === entryRequestId.current) setEntriesLoading(false);
    }
  }, [request, session, page, search, projectFilter, statusFilter, fromDate, toDate]);

  const refreshTokens = useCallback(async () => {
    if (!session) return;
    try {
      const data = await request('/api/tokens');
      setApiTokens(data.tokens);
    } catch (caught) { setError(caught instanceof Error ? caught.message : 'Could not load API tokens'); }
  }, [request, session]);

  useEffect(() => {
    if (!session) { setEntry(null); setEntries([]); setApiTokens([]); setNewToken(''); entryRequestId.current += 1; return; }
    void refreshTimer();
    void refreshTokens();
    const ticker = window.setInterval(() => setNow(Date.now()), 1000);
    const sync = window.setInterval(() => void refreshTimer(), 30000);
    const onFocus = () => void refreshTimer();
    window.addEventListener('focus', onFocus);
    return () => { window.clearInterval(ticker); window.clearInterval(sync); window.removeEventListener('focus', onFocus); };
  }, [session, refreshTimer, refreshTokens]);

  useEffect(() => {
    if (!session) return;
    void loadEntries();
    const onFocus = () => void loadEntries();
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [session, loadEntries]);

  function navigate(next: View) {
    setView(next);
    window.location.hash = next;
  }

  function clearFilters() {
    setSearchInput(''); setSearch(''); setProjectFilter(''); setStatusFilter('all');
    setFromDate(''); setToDate(''); setPage(1);
  }

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
      await Promise.all([refreshTimer(), loadEntries()]);
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
      clearFilters();
      navigate('entries');
      await loadEntries();
    } catch (caught) { setError(caught instanceof Error ? caught.message : 'Could not add entry'); }
    finally { setBusy(false); }
  }

  if (!ready) return <Box sx={{ minHeight: '100vh', display: 'grid', placeItems: 'center' }}><CircularProgress aria-label="Loading Timelogger" /></Box>;

  if (!session) return <Box sx={{ minHeight: '100vh', display: 'grid', placeItems: 'center', bgcolor: 'grey.50', p: 2 }}>
    <Card sx={{ width: '100%', maxWidth: 440, borderRadius: 3, boxShadow: 3 }}><CardContent sx={{ p: { xs: 3, sm: 4 } }}>
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

  return <Box sx={{ minHeight: '100vh', bgcolor: 'grey.50' }}>
    <AppBar position="sticky" elevation={0}><Toolbar><Typography variant="h6" sx={{ flexGrow: 1, fontWeight: 700 }}>Timelogger</Typography><Typography variant="body2" sx={{ display: { xs: 'none', sm: 'block' }, mr: 2 }}>{session.user.email}</Typography><Button color="inherit" onClick={() => void supabase.auth.signOut()}>Sign out</Button></Toolbar></AppBar>
    <Container maxWidth="lg" component="main" sx={{ py: { xs: 2, sm: 4 } }}><Stack spacing={3}>
      <Paper variant="outlined" sx={{ borderRadius: 3, overflow: 'hidden' }}><Tabs value={view} onChange={(_event, next: View) => navigate(next)} variant="scrollable" scrollButtons="auto" aria-label="Timelogger sections"><Tab label="Timer" value="timer" id="tab-timer" aria-controls="panel-timer" /><Tab label="Time entries" value="entries" id="tab-entries" aria-controls="panel-entries" /><Tab label="Settings" value="settings" id="tab-settings" aria-controls="panel-settings" /></Tabs></Paper>
      {error && <Alert severity="error" onClose={() => setError('')}>{error}</Alert>}
      {notice && <Alert severity="success" onClose={() => setNotice('')}>{notice}</Alert>}
      {view === 'timer' && <Box role="tabpanel" id="panel-timer" aria-labelledby="tab-timer"><Stack spacing={3}>
      <Box><Typography variant="h4" sx={{ fontWeight: 700 }}>Track your time</Typography><Typography color="text.secondary">Start a timer or add an entry for work already done.</Typography></Box>
      <Grid container spacing={3}>
        <Grid size={{ xs: 12, md: 7 }}><Card sx={{ height: '100%', borderRadius: 3 }}><CardContent sx={{ p: { xs: 2, sm: 3 } }}><Stack spacing={3}>
          <Box><Typography variant="h6" sx={{ fontWeight: 700 }}>Timer</Typography><Typography color="text.secondary">Keeps counting even when this page is closed.</Typography></Box>
          <Typography variant="h2" sx={{ fontWeight: 700, fontSize: { xs: '2.5rem', sm: '3.75rem' }, fontVariantNumeric: 'tabular-nums', letterSpacing: -2 }}>{entry ? duration(currentDuration(entry, now)) : '00:00:00'}</Typography>
          {entry && <Chip label={entry.status === 'running' ? 'Running' : 'Paused'} color={entry.status === 'running' ? 'success' : 'warning'} sx={{ alignSelf: 'flex-start' }} />}
          <TextField label="Project" value={entry ? entry.project : project} onChange={(e) => setProject(e.target.value)} disabled={!!entry} fullWidth slotProps={{ htmlInput: { maxLength: 500 } }} />
          <TextField label="Task" value={entry ? entry.task : task} onChange={(e) => setTask(e.target.value)} disabled={!!entry} fullWidth slotProps={{ htmlInput: { maxLength: 500 } }} />
          <TextField label="Description" value={entry ? entry.description : description} onChange={(e) => setDescription(e.target.value)} disabled={!!entry} fullWidth multiline minRows={2} slotProps={{ htmlInput: { maxLength: 500 } }} />
          <Stack direction="row" spacing={1} sx={{ flexWrap: 'wrap', gap: 1 }}>
            {!entry && <Button variant="contained" size="large" disabled={busy} onClick={() => void timerAction('start')}>Start timer</Button>}
            {entry?.status === 'running' && <Button variant="contained" size="large" color="warning" disabled={busy} onClick={() => void timerAction('pause')}>Pause</Button>}
            {entry?.status === 'paused' && <Button variant="contained" size="large" disabled={busy} onClick={() => void timerAction('resume')}>Resume</Button>}
            {entry && <Button variant="outlined" size="large" color="error" disabled={busy} onClick={() => void timerAction('stop')}>Stop</Button>}
          </Stack>
        </Stack></CardContent></Card></Grid>
        <Grid size={{ xs: 12, md: 5 }}><Card sx={{ height: '100%', borderRadius: 3 }}><CardContent sx={{ p: { xs: 2, sm: 3 } }}><Stack spacing={2}>
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
      <Paper variant="outlined" sx={{ borderRadius: 3, p: 3 }}><Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} sx={{ alignItems: { sm: 'center' }, justifyContent: 'space-between' }}><Box><Typography variant="h6" sx={{ fontWeight: 700 }}>Find your work</Typography><Typography color="text.secondary">Browse and search all of your time entries.</Typography></Box><Button variant="contained" onClick={() => navigate('entries')}>View time entries</Button></Stack></Paper>
      </Stack></Box>}
      {view === 'entries' && <Box role="tabpanel" id="panel-entries" aria-labelledby="tab-entries"><Stack spacing={3}>
        <Box><Typography variant="h4" sx={{ fontWeight: 700 }}>Time entries</Typography><Typography color="text.secondary">Search across projects, tasks, and descriptions. Use filters to narrow the results.</Typography></Box>
        <Paper variant="outlined" sx={{ borderRadius: 3, p: { xs: 2, sm: 3 } }}><Stack spacing={2}>
          <Grid container spacing={2}>
            <Grid size={{ xs: 12, md: 6 }}><TextField label="Search entries" placeholder="Project, task, or description" value={searchInput} onChange={(e) => setSearchInput(e.target.value)} fullWidth slotProps={{ htmlInput: { maxLength: 100 } }} /></Grid>
            <Grid size={{ xs: 12, sm: 6, md: 3 }}><TextField label="Project contains" value={projectFilter} onChange={(e) => { setProjectFilter(e.target.value); setPage(1); }} fullWidth slotProps={{ htmlInput: { maxLength: 100 } }} /></Grid>
            <Grid size={{ xs: 12, sm: 6, md: 3 }}><TextField select label="Status" value={statusFilter} onChange={(e) => { setStatusFilter(e.target.value as StatusFilter); setPage(1); }} fullWidth><MenuItem value="all">All statuses</MenuItem><MenuItem value="running">Running</MenuItem><MenuItem value="paused">Paused</MenuItem><MenuItem value="stopped">Stopped</MenuItem></TextField></Grid>
            <Grid size={{ xs: 12, sm: 6, md: 3 }}><TextField label="From date" type="date" value={fromDate} onChange={(e) => { setFromDate(e.target.value); setPage(1); }} fullWidth slotProps={{ inputLabel: { shrink: true } }} /></Grid>
            <Grid size={{ xs: 12, sm: 6, md: 3 }}><TextField label="To date" type="date" value={toDate} onChange={(e) => { setToDate(e.target.value); setPage(1); }} fullWidth slotProps={{ inputLabel: { shrink: true } }} /></Grid>
          </Grid>
          <Box><Button onClick={clearFilters} disabled={!searchInput && !projectFilter && statusFilter === 'all' && !fromDate && !toDate}>Clear filters</Button></Box>
        </Stack></Paper>
        <Paper variant="outlined" sx={{ borderRadius: 3, overflow: 'hidden' }}><Stack>
          <Box sx={{ p: { xs: 2, sm: 3 }, display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 2 }}><Typography variant="h6" sx={{ fontWeight: 700 }}>Results</Typography><Typography variant="body2" color="text.secondary" aria-live="polite">{entriesLoading ? 'Loading…' : `${entryCount} ${entryCount === 1 ? 'entry' : 'entries'}`}</Typography></Box>
          <Divider />
          {entriesError && <Alert severity="error" sx={{ m: 2 }} action={<Button color="inherit" size="small" onClick={() => void loadEntries()}>Retry</Button>}>{entriesError}</Alert>}
          {entriesLoading && <Box sx={{ display: 'grid', placeItems: 'center', py: 6 }}><CircularProgress aria-label="Loading entries" /></Box>}
          {!entriesLoading && !entriesError && entries.length === 0 && <Box sx={{ p: 4, textAlign: 'center' }}><Typography variant="h6">No entries found</Typography><Typography color="text.secondary">{search || projectFilter || statusFilter !== 'all' || fromDate || toDate ? 'Try another search or clear the filters.' : 'Start a timer or add time manually to see it here.'}</Typography>{!search && !projectFilter && statusFilter === 'all' && !fromDate && !toDate && <Button sx={{ mt: 2 }} onClick={() => navigate('timer')}>Go to timer</Button>}</Box>}
          {!entriesLoading && !entriesError && entries.length > 0 && <>
            <TableContainer sx={{ display: { xs: 'none', md: 'block' } }}><Table aria-label="Time entries"><TableHead><TableRow><TableCell>Work</TableCell><TableCell>Project</TableCell><TableCell>Started</TableCell><TableCell>Status</TableCell><TableCell align="right">Duration</TableCell></TableRow></TableHead><TableBody>
              {entries.map((item) => <TableRow key={item.id} hover><TableCell><Typography sx={{ fontWeight: 600 }}>{item.task || 'Untitled work'}</Typography>{item.description && <Typography variant="body2" color="text.secondary">{item.description}</Typography>}</TableCell><TableCell>{item.project || '—'}</TableCell><TableCell>{new Date(item.start_at).toLocaleString()}</TableCell><TableCell><Chip size="small" label={item.status} color={item.status === 'running' ? 'success' : item.status === 'paused' ? 'warning' : 'default'} /></TableCell><TableCell align="right" sx={{ fontVariantNumeric: 'tabular-nums', fontWeight: 600 }}>{duration(currentDuration(item, now))}</TableCell></TableRow>)}
            </TableBody></Table></TableContainer>
            <Stack divider={<Divider />} sx={{ display: { xs: 'flex', md: 'none' } }}>{entries.map((item) => <Box key={item.id} sx={{ p: 2 }}><Stack direction="row" spacing={2} sx={{ justifyContent: 'space-between', alignItems: 'flex-start' }}><Box><Typography sx={{ fontWeight: 600 }}>{item.task || 'Untitled work'}</Typography><Typography variant="body2" color="text.secondary">{item.project || 'No project'} · {new Date(item.start_at).toLocaleString()}</Typography>{item.description && <Typography variant="body2" color="text.secondary">{item.description}</Typography>}</Box><Typography sx={{ fontVariantNumeric: 'tabular-nums', fontWeight: 600, whiteSpace: 'nowrap' }}>{duration(currentDuration(item, now))}</Typography></Stack><Chip size="small" label={item.status} color={item.status === 'running' ? 'success' : item.status === 'paused' ? 'warning' : 'default'} sx={{ mt: 1 }} /></Box>)}</Stack>
          </>}
          {!entriesLoading && !entriesError && entryCount > pageSize && <Box sx={{ p: 2, display: 'flex', justifyContent: 'center' }}><Pagination count={Math.ceil(entryCount / pageSize)} page={page} onChange={(_event, next) => setPage(next)} showFirstButton showLastButton color="primary" aria-label="Time entry pages" /></Box>}
        </Stack></Paper>
      </Stack></Box>}
      {view === 'settings' && <Box role="tabpanel" id="panel-settings" aria-labelledby="tab-settings"><Stack spacing={3}>
        <Box><Typography variant="h4" sx={{ fontWeight: 700 }}>Settings</Typography><Typography color="text.secondary">Manage integration access to your account.</Typography></Box>
      <Paper variant="outlined" sx={{ borderRadius: 3, p: 3 }}><Stack spacing={2}>
        <Box><Typography variant="h6" sx={{ fontWeight: 700 }}>API tokens</Typography><Typography color="text.secondary">Create a token for the Jira app. Each token expires after 90 days and can be revoked here.</Typography></Box>
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
      </Stack></Box>}
    </Stack></Container>
  </Box>;
}
