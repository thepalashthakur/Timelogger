'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Session } from '@supabase/supabase-js';
import {
  Alert, AppBar, Box, Button, ButtonBase, Card, CardContent, Chip, CircularProgress,
  Container, Dialog, DialogActions, DialogContent, DialogTitle, Divider, Grid,
  MenuItem, Pagination, Paper, Stack, Tab, Table,
  TableBody, TableCell, TableContainer, TableHead, TableRow, Tabs, TextField, Toolbar,
  ToggleButton, ToggleButtonGroup, Tooltip, Typography,
} from '@mui/material';
import { browserClient, type TimeEntry } from '@/lib/supabase';
import { addDays, layoutDay, startOfWeek } from '@/lib/timeline';

type ApiTokenRecord = {
  id: string;
  name: string;
  created_at: string;
  expires_at: string;
  last_used_at: string | null;
};
type View = 'dashboard' | 'entries' | 'settings';
type StatusFilter = 'all' | TimeEntry['status'];
const pageSize = 20;
const defaultHourHeight = 58;

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
  const [view, setView] = useState<View>('dashboard');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [project, setProject] = useState('');
  const [task, setTask] = useState('');
  const [description, setDescription] = useState('');
  const [entry, setEntry] = useState<TimeEntry | null>(null);
  const [timelineMode, setTimelineMode] = useState<'week' | 'day'>('week');
  const [timelineAnchor, setTimelineAnchor] = useState(() => new Date());
  const [hourHeight, setHourHeight] = useState(defaultHourHeight);
  const [timelineExpanded, setTimelineExpanded] = useState(false);
  const [timelineEntries, setTimelineEntries] = useState<TimeEntry[]>([]);
  const [timelineLoading, setTimelineLoading] = useState(false);
  const [timelineError, setTimelineError] = useState('');
  const [timelineTruncated, setTimelineTruncated] = useState(false);
  const timelineRequestId = useRef(0);
  const timelineScrollRef = useRef<HTMLDivElement>(null);
  const [selectedTimelineEntry, setSelectedTimelineEntry] = useState<TimeEntry | null>(null);
  const [manualDialogOpen, setManualDialogOpen] = useState(false);
  const [editingEntry, setEditingEntry] = useState<TimeEntry | null>(null);
  const [deletingEntry, setDeletingEntry] = useState<TimeEntry | null>(null);
  const [editProject, setEditProject] = useState('');
  const [editTask, setEditTask] = useState('');
  const [editDescription, setEditDescription] = useState('');
  const [editStart, setEditStart] = useState('');
  const [editEnd, setEditEnd] = useState('');
  const [entryDialogError, setEntryDialogError] = useState('');
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
      if (hash === 'timer') setView('dashboard');
      if (hash === 'dashboard' || hash === 'entries' || hash === 'settings') setView(hash);
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

  const timelineDays = useMemo(() => {
    const first = timelineMode === 'week' ? startOfWeek(timelineAnchor) : new Date(timelineAnchor);
    first.setHours(0, 0, 0, 0);
    return Array.from({ length: timelineMode === 'week' ? 7 : 1 }, (_unused, index) => addDays(first, index));
  }, [timelineAnchor, timelineMode]);

  const loadTimeline = useCallback(async () => {
    if (!session) return;
    const id = ++timelineRequestId.current;
    setTimelineLoading(true);
    setTimelineError('');
    const from = timelineDays[0].toISOString();
    const to = addDays(timelineDays[timelineDays.length - 1], 1).toISOString();
    try {
      const data = await request(`/api/timeline?${new URLSearchParams({ from, to })}`);
      if (id === timelineRequestId.current) {
        setTimelineEntries(data.entries);
        setTimelineTruncated(data.truncated);
      }
    } catch (caught) {
      if (id === timelineRequestId.current) setTimelineError(caught instanceof Error ? caught.message : 'Could not load timeline');
    } finally {
      if (id === timelineRequestId.current) setTimelineLoading(false);
    }
  }, [request, session, timelineDays]);

  const refreshTokens = useCallback(async () => {
    if (!session) return;
    try {
      const data = await request('/api/tokens');
      setApiTokens(data.tokens);
    } catch (caught) { setError(caught instanceof Error ? caught.message : 'Could not load API tokens'); }
  }, [request, session]);

  useEffect(() => {
    if (!session) { setEntry(null); setEntries([]); setTimelineEntries([]); setApiTokens([]); setNewToken(''); entryRequestId.current += 1; timelineRequestId.current += 1; return; }
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

  useEffect(() => {
    if (!session) return;
    void loadTimeline();
    const onFocus = () => void loadTimeline();
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [session, loadTimeline]);

  useEffect(() => {
    if (view !== 'dashboard' || !timelineScrollRef.current) return;
    const todayVisible = timelineDays.some((day) => day.toDateString() === new Date().toDateString());
    timelineScrollRef.current.scrollTop = (todayVisible ? Math.max(0, new Date().getHours() - 2) : 8) * hourHeight;
  }, [view, timelineDays]);

  function navigate(next: View) {
    setView(next);
    window.location.hash = next;
  }

  function changeZoom(step: number) {
    const next = Math.max(29, Math.min(116, hourHeight + step));
    const scrollTop = timelineScrollRef.current?.scrollTop ?? 0;
    setHourHeight(next);
    window.requestAnimationFrame(() => {
      if (timelineScrollRef.current) timelineScrollRef.current.scrollTop = scrollTop * next / hourHeight;
    });
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
      await Promise.all([refreshTimer(), loadEntries(), loadTimeline()]);
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
      setManualDialogOpen(false);
      await Promise.all([loadEntries(), loadTimeline()]);
    } catch (caught) { setError(caught instanceof Error ? caught.message : 'Could not add entry'); }
    finally { setBusy(false); }
  }

  function openEdit(item: TimeEntry) {
    setSelectedTimelineEntry(null);
    setEntryDialogError('');
    setEditProject(item.project);
    setEditTask(item.task);
    setEditDescription(item.description);
    setEditStart(dateTimeLocal(new Date(item.start_at)));
    setEditEnd(item.end_at ? dateTimeLocal(new Date(item.end_at)) : '');
    setEditingEntry(item);
  }

  async function updateEntry(event: React.FormEvent) {
    event.preventDefault();
    if (!editingEntry) return;
    setBusy(true); setEntryDialogError(''); setNotice('');
    try {
      const startChanged = editingEntry.status === 'stopped' && editStart !== dateTimeLocal(new Date(editingEntry.start_at));
      const endChanged = editingEntry.status === 'stopped' && !!editingEntry.end_at && editEnd !== dateTimeLocal(new Date(editingEntry.end_at));
      await request(`/api/entries/${editingEntry.id}`, { method: 'PATCH', body: JSON.stringify({
        project: editProject, task: editTask, description: editDescription,
        ...(startChanged ? { start_at: new Date(editStart).toISOString() } : {}),
        ...(endChanged ? { end_at: new Date(editEnd).toISOString() } : {}),
      }) });
      setEditingEntry(null);
      setNotice('Time entry updated');
      await Promise.all([refreshTimer(), loadEntries(), loadTimeline()]);
    } catch (caught) { setEntryDialogError(caught instanceof Error ? caught.message : 'Could not update entry'); }
    finally { setBusy(false); }
  }

  async function deleteEntry() {
    if (!deletingEntry) return;
    setBusy(true); setEntryDialogError(''); setNotice('');
    try {
      await request(`/api/entries/${deletingEntry.id}`, { method: 'DELETE' });
      setDeletingEntry(null);
      setSelectedTimelineEntry(null);
      setNotice('Time entry deleted');
      if (page > 1 && entries.length === 1) setPage(page - 1);
      else await loadEntries();
      await Promise.all([refreshTimer(), loadTimeline()]);
    } catch (caught) { setEntryDialogError(caught instanceof Error ? caught.message : 'Could not delete entry'); }
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
      <Paper variant="outlined" sx={{ borderRadius: 3, overflow: 'hidden' }}><Tabs value={view} onChange={(_event, next: View) => navigate(next)} variant="scrollable" scrollButtons="auto" aria-label="Timelogger sections"><Tab label="Dashboard" value="dashboard" id="tab-dashboard" aria-controls="panel-dashboard" /><Tab label="Time entries" value="entries" id="tab-entries" aria-controls="panel-entries" /><Tab label="Settings" value="settings" id="tab-settings" aria-controls="panel-settings" /></Tabs></Paper>
      {error && <Alert severity="error" onClose={() => setError('')}>{error}</Alert>}
      {notice && <Alert severity="success" onClose={() => setNotice('')}>{notice}</Alert>}
      {view === 'dashboard' && <Box role="tabpanel" id="panel-dashboard" aria-labelledby="tab-dashboard"><Stack spacing={2}>
        <Paper variant="outlined" sx={{ p: 2, borderRadius: 3 }}><Stack spacing={2}>
          <Stack direction={{ xs: 'column', md: 'row' }} spacing={2} sx={{ alignItems: { md: 'center' } }}>
            <TextField label="What are you working on?" value={entry ? entry.description : description} onChange={(e) => setDescription(e.target.value)} disabled={!!entry} fullWidth slotProps={{ htmlInput: { maxLength: 500 } }} />
            <Typography variant="h5" sx={{ minWidth: 112, fontVariantNumeric: 'tabular-nums', fontWeight: 700, whiteSpace: 'nowrap' }}>{entry ? duration(currentDuration(entry, now)) : '00:00:00'}</Typography>
            <Stack direction="row" spacing={1}>
              {!entry && <Button variant="contained" disabled={busy} onClick={() => void timerAction('start')}>Start</Button>}
              {entry?.status === 'running' && <Button variant="contained" color="warning" disabled={busy} onClick={() => void timerAction('pause')}>Pause</Button>}
              {entry?.status === 'paused' && <Button variant="contained" disabled={busy} onClick={() => void timerAction('resume')}>Resume</Button>}
              {entry && <Button variant="outlined" color="error" disabled={busy} onClick={() => void timerAction('stop')}>Stop</Button>}
            </Stack>
          </Stack>
          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1}>
            <TextField label="Project" value={entry ? entry.project : project} onChange={(e) => setProject(e.target.value)} disabled={!!entry} size="small" sx={{ flex: 1 }} slotProps={{ htmlInput: { maxLength: 500 } }} />
            <TextField label="Task" value={entry ? entry.task : task} onChange={(e) => setTask(e.target.value)} disabled={!!entry} size="small" sx={{ flex: 1 }} slotProps={{ htmlInput: { maxLength: 500 } }} />
            {entry && <Chip label={entry.status === 'running' ? 'Running' : 'Paused'} color={entry.status === 'running' ? 'success' : 'warning'} sx={{ alignSelf: 'center' }} />}
            <Button onClick={() => setManualDialogOpen(true)}>Add time manually</Button>
          </Stack>
        </Stack></Paper>
        <Paper variant="outlined" sx={{ borderRadius: 3, overflow: 'hidden' }}><Stack>
          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} sx={{ p: 2, alignItems: { sm: 'center' }, justifyContent: 'space-between' }}>
            <Box><Typography variant="h5" sx={{ fontWeight: 700 }}>Timeline</Typography><Typography variant="body2" color="text.secondary">{timelineMode === 'week' ? `${timelineDays[0].toLocaleDateString(undefined, { month: 'short', day: 'numeric' })} – ${timelineDays[6].toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}` : timelineDays[0].toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric', year: 'numeric' })}</Typography></Box>
            <Stack direction="row" spacing={1} sx={{ flexWrap: 'wrap', alignItems: 'center' }}>
              <Button aria-label="Previous period" onClick={() => setTimelineAnchor(addDays(timelineAnchor, timelineMode === 'week' ? -7 : -1))}>‹</Button>
              <Button onClick={() => setTimelineAnchor(new Date())}>Today</Button>
              <Button aria-label="Next period" onClick={() => setTimelineAnchor(addDays(timelineAnchor, timelineMode === 'week' ? 7 : 1))}>›</Button>
              <TextField label="Go to date" type="date" size="small" value={dateTimeLocal(timelineAnchor).slice(0, 10)} onChange={(event) => { if (event.target.value) setTimelineAnchor(new Date(`${event.target.value}T12:00:00`)); }} slotProps={{ inputLabel: { shrink: true } }} sx={{ width: 170 }} />
              <ToggleButtonGroup size="small" exclusive value={timelineMode} onChange={(_event, value: 'week' | 'day' | null) => { if (value) setTimelineMode(value); }} aria-label="Timeline view"><ToggleButton value="week">Week</ToggleButton><ToggleButton value="day">Day</ToggleButton></ToggleButtonGroup>
              <Tooltip title="Zoom out"><span><Button aria-label="Zoom out" disabled={hourHeight <= 29} onClick={() => changeZoom(-14)}>−</Button></span></Tooltip>
              <Typography variant="body2" sx={{ minWidth: 42, textAlign: 'center' }}>{Math.round(hourHeight / defaultHourHeight * 100)}%</Typography>
              <Tooltip title="Zoom in"><span><Button aria-label="Zoom in" disabled={hourHeight >= 116} onClick={() => changeZoom(14)}>+</Button></span></Tooltip>
              <Button onClick={() => setTimelineExpanded(!timelineExpanded)}>{timelineExpanded ? 'Collapse' : 'Expand'}</Button>
            </Stack>
          </Stack>
          <Divider />
          {timelineError && <Alert severity="error" sx={{ m: 2 }} action={<Button color="inherit" size="small" onClick={() => void loadTimeline()}>Retry</Button>}>{timelineError}</Alert>}
          {timelineTruncated && <Alert severity="warning" sx={{ m: 2 }}>This period has more than 500 entries. Use the Time entries view to find the rest.</Alert>}
          {timelineLoading && <Box sx={{ display: 'grid', placeItems: 'center', py: 1 }}><CircularProgress size={24} aria-label="Loading timeline" /></Box>}
          <Box ref={timelineScrollRef} sx={{ overflowX: 'auto', overflowY: 'auto', maxHeight: timelineExpanded ? 'none' : 720 }}>
            <Box sx={{ display: 'grid', gridTemplateColumns: `72px repeat(${timelineDays.length}, minmax(${timelineMode === 'week' ? 130 : 360}px, 1fr))`, minWidth: timelineMode === 'week' ? 980 : 440 }}>
              <Box sx={{ borderRight: 1, borderBottom: 1, borderColor: 'divider', bgcolor: 'background.paper', position: 'sticky', top: 0, zIndex: 3 }} />
              {timelineDays.map((day) => <Box key={day.toISOString()} sx={{ p: 1, textAlign: 'center', borderRight: 1, borderBottom: 1, borderColor: 'divider', bgcolor: day.toDateString() === new Date(now).toDateString() ? 'rgba(25,118,210,0.08)' : 'background.paper', position: 'sticky', top: 0, zIndex: 2 }}><Typography variant="body2" sx={{ fontWeight: 700 }}>{day.toLocaleDateString(undefined, { weekday: 'short' })} {day.getDate()}</Typography></Box>)}
              <Box sx={{ height: 24 * hourHeight, position: 'relative', borderRight: 1, borderColor: 'divider' }}>{Array.from({ length: 24 }, (_unused, hour) => <Typography key={hour} variant="caption" color="text.secondary" sx={{ position: 'absolute', top: hour * hourHeight - 8, right: 8, fontVariantNumeric: 'tabular-nums' }}>{new Date(2020, 0, 1, hour).toLocaleTimeString(undefined, { hour: 'numeric' })}</Typography>)}</Box>
              {timelineDays.map((day) => <Box key={day.toISOString()} sx={{ height: 24 * hourHeight, position: 'relative', borderRight: 1, borderColor: 'divider', bgcolor: day.toDateString() === new Date(now).toDateString() ? 'rgba(25,118,210,0.025)' : 'background.paper' }}>
                {Array.from({ length: 24 }, (_unused, hour) => <Box key={hour} sx={{ position: 'absolute', top: hour * hourHeight, left: 0, right: 0, borderTop: 1, borderColor: 'divider' }} />)}
                {layoutDay(timelineEntries, day, now).map((segment) => <Tooltip key={segment.entry.id} title={`${segment.entry.task || segment.entry.description || 'Untitled work'} · ${duration(currentDuration(segment.entry, now))}`}><ButtonBase onClick={() => setSelectedTimelineEntry(segment.entry)} sx={{ position: 'absolute', top: segment.startMinute * hourHeight / 60, height: Math.max(20, (segment.endMinute - segment.startMinute) * hourHeight / 60), left: `calc(${segment.lane * 100 / segment.laneCount}% + 2px)`, width: `calc(${100 / segment.laneCount}% - 4px)`, bgcolor: segment.entry.status === 'running' ? 'success.light' : segment.entry.status === 'paused' ? 'warning.light' : 'primary.light', borderLeft: 3, borderColor: segment.entry.status === 'running' ? 'success.main' : segment.entry.status === 'paused' ? 'warning.main' : 'primary.main', borderRadius: 1, px: 0.5, overflow: 'hidden', textAlign: 'left', alignItems: 'flex-start', justifyContent: 'flex-start', zIndex: 1 }}><Typography variant="caption" sx={{ fontWeight: 700, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: 'text.primary' }}>{segment.entry.task || segment.entry.description || 'Untitled work'}</Typography></ButtonBase></Tooltip>)}
                {day.toDateString() === new Date(now).toDateString() && <Box sx={{ position: 'absolute', top: (new Date(now).getHours() * 60 + new Date(now).getMinutes()) * hourHeight / 60, left: 0, right: 0, borderTop: 2, borderColor: 'error.main', pointerEvents: 'none', zIndex: 2 }} />}
              </Box>)}
            </Box>
          </Box>
          <Divider />
          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} sx={{ p: 2, justifyContent: 'space-between', alignItems: { sm: 'center' } }}><Typography variant="body2" color="text.secondary">Click a block to edit or delete its entry. Paused timers use a short marker at their start because pause time is not stored.</Typography><Button onClick={() => navigate('entries')}>Manage time entries</Button></Stack>
        </Stack></Paper>
      </Stack></Box>}
      {view === 'entries' && <Box role="tabpanel" id="panel-entries" aria-labelledby="tab-entries"><Stack spacing={3}>
        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} sx={{ justifyContent: 'space-between', alignItems: { sm: 'center' } }}><Box><Typography variant="h4" sx={{ fontWeight: 700 }}>Time entries</Typography><Typography color="text.secondary">Search, edit, and manage your completed entries.</Typography></Box><Button variant="contained" onClick={() => setManualDialogOpen(true)}>Add entry</Button></Stack>
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
          {!entriesLoading && !entriesError && entries.length === 0 && <Box sx={{ p: 4, textAlign: 'center' }}><Typography variant="h6">No entries found</Typography><Typography color="text.secondary">{search || projectFilter || statusFilter !== 'all' || fromDate || toDate ? 'Try another search or clear the filters.' : 'Start a timer or add time manually to see it here.'}</Typography>{!search && !projectFilter && statusFilter === 'all' && !fromDate && !toDate && <Button sx={{ mt: 2 }} onClick={() => navigate('dashboard')}>Go to dashboard</Button>}</Box>}
          {!entriesLoading && !entriesError && entries.length > 0 && <>
            <TableContainer sx={{ display: { xs: 'none', md: 'block' } }}><Table aria-label="Time entries"><TableHead><TableRow><TableCell>Work and actions</TableCell><TableCell>Project</TableCell><TableCell>Started</TableCell><TableCell>Status</TableCell><TableCell align="right">Duration</TableCell></TableRow></TableHead><TableBody>
              {entries.map((item) => <TableRow key={item.id} hover><TableCell><Typography sx={{ fontWeight: 600 }}>{item.task || 'Untitled work'}</Typography>{item.description && <Typography variant="body2" color="text.secondary">{item.description}</Typography>}<Stack direction="row" spacing={0.5} sx={{ mt: 0.5 }}><Button size="small" onClick={() => openEdit(item)} aria-label={`Edit ${item.task || 'time entry'}`}>Edit</Button><Button size="small" color="error" onClick={() => { setEntryDialogError(''); setDeletingEntry(item); }} aria-label={`Delete ${item.task || 'time entry'}`}>Delete</Button></Stack></TableCell><TableCell>{item.project || '—'}</TableCell><TableCell>{new Date(item.start_at).toLocaleString()}</TableCell><TableCell><Chip size="small" label={item.status} color={item.status === 'running' ? 'success' : item.status === 'paused' ? 'warning' : 'default'} /></TableCell><TableCell align="right" sx={{ fontVariantNumeric: 'tabular-nums', fontWeight: 600 }}>{duration(currentDuration(item, now))}</TableCell></TableRow>)}
            </TableBody></Table></TableContainer>
            <Stack divider={<Divider />} sx={{ display: { xs: 'flex', md: 'none' } }}>{entries.map((item) => <Box key={item.id} sx={{ p: 2 }}><Stack direction="row" spacing={2} sx={{ justifyContent: 'space-between', alignItems: 'flex-start' }}><Box><Typography sx={{ fontWeight: 600 }}>{item.task || 'Untitled work'}</Typography><Typography variant="body2" color="text.secondary">{item.project || 'No project'} · {new Date(item.start_at).toLocaleString()}</Typography>{item.description && <Typography variant="body2" color="text.secondary">{item.description}</Typography>}</Box><Typography sx={{ fontVariantNumeric: 'tabular-nums', fontWeight: 600, whiteSpace: 'nowrap' }}>{duration(currentDuration(item, now))}</Typography></Stack><Chip size="small" label={item.status} color={item.status === 'running' ? 'success' : item.status === 'paused' ? 'warning' : 'default'} sx={{ mt: 1 }} /><Stack direction="row" spacing={1} sx={{ mt: 1 }}><Button size="small" onClick={() => openEdit(item)}>Edit</Button><Button size="small" color="error" onClick={() => { setEntryDialogError(''); setDeletingEntry(item); }}>Delete</Button></Stack></Box>)}</Stack>
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
    <Dialog open={manualDialogOpen} onClose={() => setManualDialogOpen(false)} fullWidth maxWidth="sm"><Box component="form" onSubmit={createManual}><DialogTitle>Add time manually</DialogTitle><DialogContent><Stack spacing={2} sx={{ pt: 1 }}>
      <TextField label="Project" value={manualProject} onChange={(e) => setManualProject(e.target.value)} fullWidth slotProps={{ htmlInput: { maxLength: 500 } }} />
      <TextField label="Task" value={manualTask} onChange={(e) => setManualTask(e.target.value)} fullWidth slotProps={{ htmlInput: { maxLength: 500 } }} />
      <TextField label="Description" value={manualDescription} onChange={(e) => setManualDescription(e.target.value)} fullWidth multiline minRows={2} slotProps={{ htmlInput: { maxLength: 500 } }} />
      <TextField label="Start" type="datetime-local" value={manualStart} onChange={(e) => setManualStart(e.target.value)} slotProps={{ inputLabel: { shrink: true } }} required fullWidth />
      <TextField label="End" type="datetime-local" value={manualEnd} onChange={(e) => setManualEnd(e.target.value)} slotProps={{ inputLabel: { shrink: true } }} required fullWidth />
      {error && <Alert severity="error">{error}</Alert>}
    </Stack></DialogContent><DialogActions><Button onClick={() => setManualDialogOpen(false)}>Cancel</Button><Button type="submit" variant="contained" disabled={busy}>Add entry</Button></DialogActions></Box></Dialog>
    <Dialog open={!!selectedTimelineEntry} onClose={() => setSelectedTimelineEntry(null)} fullWidth maxWidth="xs"><DialogTitle>Time entry</DialogTitle><DialogContent><Stack spacing={1}>
      <Typography variant="h6">{selectedTimelineEntry?.task || selectedTimelineEntry?.description || 'Untitled work'}</Typography>
      <Typography>Project: {selectedTimelineEntry?.project || 'No project'}</Typography>
      {selectedTimelineEntry?.description && <Typography color="text.secondary">{selectedTimelineEntry.description}</Typography>}
      {selectedTimelineEntry && <><Typography>Started: {new Date(selectedTimelineEntry.start_at).toLocaleString()}</Typography><Typography>{selectedTimelineEntry.end_at ? `Ended: ${new Date(selectedTimelineEntry.end_at).toLocaleString()}` : `Status: ${selectedTimelineEntry.status}`}</Typography><Typography sx={{ fontVariantNumeric: 'tabular-nums' }}>Tracked: {duration(currentDuration(selectedTimelineEntry, now))}</Typography></>}
    </Stack></DialogContent><DialogActions>{selectedTimelineEntry && <><Button onClick={() => openEdit(selectedTimelineEntry)}>Edit</Button><Button color="error" onClick={() => { setEntryDialogError(''); setDeletingEntry(selectedTimelineEntry); setSelectedTimelineEntry(null); }}>Delete</Button></>}<Button onClick={() => setSelectedTimelineEntry(null)}>Close</Button></DialogActions></Dialog>
    <Dialog open={!!editingEntry} onClose={() => { if (!busy) setEditingEntry(null); }} fullWidth maxWidth="sm"><Box component="form" onSubmit={updateEntry}><DialogTitle>Edit time entry</DialogTitle><DialogContent><Stack spacing={2} sx={{ pt: 1 }}>
      <TextField label="Project" value={editProject} onChange={(e) => setEditProject(e.target.value)} fullWidth slotProps={{ htmlInput: { maxLength: 500 } }} />
      <TextField label="Task" value={editTask} onChange={(e) => setEditTask(e.target.value)} fullWidth slotProps={{ htmlInput: { maxLength: 500 } }} />
      <TextField label="Description" value={editDescription} onChange={(e) => setEditDescription(e.target.value)} fullWidth multiline minRows={2} slotProps={{ htmlInput: { maxLength: 500 } }} />
      {editingEntry?.status === 'stopped' ? <><TextField label="Start" type="datetime-local" value={editStart} onChange={(e) => setEditStart(e.target.value)} slotProps={{ inputLabel: { shrink: true } }} required fullWidth /><TextField label="End" type="datetime-local" value={editEnd} onChange={(e) => setEditEnd(e.target.value)} slotProps={{ inputLabel: { shrink: true } }} required fullWidth /><Typography variant="body2" color="text.secondary">Changing start or end time recalculates tracked duration from the new time range.</Typography></> : <Typography variant="body2" color="text.secondary">Stop this timer to edit its start and end times.</Typography>}
      {entryDialogError && <Alert severity="error">{entryDialogError}</Alert>}
    </Stack></DialogContent><DialogActions><Button onClick={() => setEditingEntry(null)} disabled={busy}>Cancel</Button><Button type="submit" variant="contained" disabled={busy}>Save changes</Button></DialogActions></Box></Dialog>
    <Dialog open={!!deletingEntry} onClose={() => { if (!busy) setDeletingEntry(null); }} fullWidth maxWidth="xs"><DialogTitle>Delete time entry?</DialogTitle><DialogContent><Typography>Delete “{deletingEntry?.task || deletingEntry?.description || 'Untitled work'}”? {deletingEntry?.status === 'stopped' ? 'This cannot be undone.' : 'This will remove the active timer and cannot be undone.'}</Typography>{entryDialogError && <Alert severity="error" sx={{ mt: 2 }}>{entryDialogError}</Alert>}</DialogContent><DialogActions><Button onClick={() => setDeletingEntry(null)} disabled={busy}>Cancel</Button><Button variant="contained" color="error" onClick={() => void deleteEntry()} disabled={busy}>Delete entry</Button></DialogActions></Dialog>
  </Box>;
}
