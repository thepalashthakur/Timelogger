'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Session } from '@supabase/supabase-js';
import {
  Accordion, AccordionDetails, AccordionSummary, Alert, AppBar, Autocomplete, Box, Button, ButtonBase, Card, CardContent, Chip, CircularProgress,
  Container, Dialog, DialogActions, DialogContent, DialogTitle, Divider, Grid,
  MenuItem, Pagination, Paper, Stack, Tab, Table,
  TableBody, TableCell, TableContainer, TableHead, TableRow, Tabs, TextField, Toolbar,
  ToggleButton, ToggleButtonGroup, Tooltip, Typography,
} from '@mui/material';
import { DatePicker } from '@mui/x-date-pickers/DatePicker';
import { TimePicker } from '@mui/x-date-pickers/TimePicker';
import { LocalizationProvider } from '@mui/x-date-pickers/LocalizationProvider';
import { AdapterDayjs } from '@mui/x-date-pickers/AdapterDayjs';
import dayjs, { type Dayjs } from 'dayjs';
import { browserClient, passwordCheckClient, type TimeEntry } from '@/lib/supabase';
import { addDays, layoutDay, startOfWeek } from '@/lib/timeline';
import { calendarScript } from '@/lib/calendar-script';

type ApiTokenRecord = {
  id: string;
  name: string;
  created_at: string;
  expires_at: string;
  last_used_at: string | null;
};
type CalendarSyncRecord = { entry_id: string; desired_action: 'upsert' | 'delete'; status: 'pending' | 'failed'; last_error: string | null };
type GoogleCalendarOption = { id: string; summary: string; primary?: boolean };
type View = 'dashboard' | 'entries' | 'catalog' | 'settings';
type StatusFilter = 'all' | TimeEntry['status'];
type ProjectRecord = { id: string; key: string; name: string; color: string; archived: boolean };
type TaskRecord = { id: string; project_id: string; key: string; name: string; archived: boolean; parent_task_id: string | null; issue_type: string; source: 'manual' | 'jira' };
type TagRecord = { id: string; name: string; color: string };
type CatalogKind = 'project' | 'task' | 'tag';
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

function combineDateAndTime(date: Dayjs | null, time: Dayjs | null) {
  if (!date?.isValid() || !time?.isValid()) return null;
  return date.hour(time.hour()).minute(time.minute()).second(0).millisecond(0);
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
  const [mode, setMode] = useState<'login' | 'signup' | 'forgot'>('login');
  const [recoveryMode, setRecoveryMode] = useState(false);
  const recoveryLinkRef = useRef(typeof window !== 'undefined' && new URLSearchParams(window.location.hash.slice(1)).get('type') === 'recovery');
  const [view, setView] = useState<View>('dashboard');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [recoveryPassword, setRecoveryPassword] = useState('');
  const [recoveryConfirm, setRecoveryConfirm] = useState('');
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [changeNonce, setChangeNonce] = useState('');
  const [changeCodeSent, setChangeCodeSent] = useState(false);
  const [changeError, setChangeError] = useState('');
  const [project, setProject] = useState('');
  const [task, setTask] = useState('');
  const [description, setDescription] = useState('');
  const [entry, setEntry] = useState<TimeEntry | null>(null);
  const [projects, setProjects] = useState<ProjectRecord[]>([]);
  const [tasks, setTasks] = useState<TaskRecord[]>([]);
  const [taskTotals, setTaskTotals] = useState<Record<string, number>>({});
  const [tags, setTags] = useState<TagRecord[]>([]);
  const [catalogError, setCatalogError] = useState('');
  const [catalogReady, setCatalogReady] = useState(false);
  const [entryTagIds, setEntryTagIds] = useState<Record<string, string[]>>({});
  const [startTagIds, setStartTagIds] = useState<string[]>([]);
  const [manualTagIds, setManualTagIds] = useState<string[]>([]);
  const [editTagIds, setEditTagIds] = useState<string[]>([]);
  const [catalogDialog, setCatalogDialog] = useState<{ kind: CatalogKind; item?: ProjectRecord | TaskRecord | TagRecord } | null>(null);
  const [catalogName, setCatalogName] = useState('');
  const [catalogKey, setCatalogKey] = useState('');
  const [catalogColor, setCatalogColor] = useState('#1976d2');
  const [catalogProjectId, setCatalogProjectId] = useState('');
  const [catalogParentTaskId, setCatalogParentTaskId] = useState('');
  const [catalogIssueType, setCatalogIssueType] = useState('Task');
  const [catalogDialogError, setCatalogDialogError] = useState('');
  const [catalogTarget, setCatalogTarget] = useState<'timer' | 'manual' | 'edit' | 'catalog'>('catalog');
  const [deletingTag, setDeletingTag] = useState<TagRecord | null>(null);
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
  const [editStartDate, setEditStartDate] = useState<Dayjs | null>(null);
  const [editStartTime, setEditStartTime] = useState<Dayjs | null>(null);
  const [editEndDate, setEditEndDate] = useState<Dayjs | null>(null);
  const [editEndTime, setEditEndTime] = useState<Dayjs | null>(null);
  const [entryDialogError, setEntryDialogError] = useState('');
  const [entries, setEntries] = useState<TimeEntry[]>([]);
  const [entryCount, setEntryCount] = useState(0);
  const [entriesLoading, setEntriesLoading] = useState(false);
  const [entriesError, setEntriesError] = useState('');
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [projectFilter, setProjectFilter] = useState('');
  const [taskFilter, setTaskFilter] = useState('');
  const [tagFilter, setTagFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');
  const [page, setPage] = useState(1);
  const entryRequestId = useRef(0);
  const [apiTokens, setApiTokens] = useState<ApiTokenRecord[]>([]);
  const [tokenName, setTokenName] = useState('Jira');
  const [newToken, setNewToken] = useState('');
  const [calendarUrl, setCalendarUrl] = useState('');
  const [savedCalendarUrl, setSavedCalendarUrl] = useState('');
  const [calendarSecret, setCalendarSecret] = useState('');
  const [calendarHasSecret, setCalendarHasSecret] = useState(false);
  const [calendarError, setCalendarError] = useState('');
  const [calendarPending, setCalendarPending] = useState<CalendarSyncRecord[]>([]);
  const [googleConnection, setGoogleConnection] = useState<{ calendar_id: string; calendar_name: string } | null>(null);
  const [googleCalendars, setGoogleCalendars] = useState<GoogleCalendarOption[]>([]);
  const [googlePending, setGooglePending] = useState<CalendarSyncRecord[]>([]);
  const [googleError, setGoogleError] = useState('');
  const [googleLinks, setGoogleLinks] = useState<Record<string, string>>({});
  const [googleCalendarDialog, setGoogleCalendarDialog] = useState(false);
  const [googleCalendarName, setGoogleCalendarName] = useState('');
  const [manualStartDate, setManualStartDate] = useState<Dayjs | null>(() => dayjs().subtract(1, 'hour'));
  const [manualStartTime, setManualStartTime] = useState<Dayjs | null>(() => dayjs().subtract(1, 'hour'));
  const [manualEndDate, setManualEndDate] = useState<Dayjs | null>(() => dayjs());
  const [manualEndTime, setManualEndTime] = useState<Dayjs | null>(() => dayjs());
  const [manualProject, setManualProject] = useState('');
  const [manualTask, setManualTask] = useState('');
  const [manualDescription, setManualDescription] = useState('');
  const [now, setNow] = useState(Date.now());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  useEffect(() => {
    if (recoveryLinkRef.current) setRecoveryMode(true);
    const { data: listener } = supabase.auth.onAuthStateChange((event, next) => {
      setSession(next);
      if (event === 'PASSWORD_RECOVERY') setRecoveryMode(true);
      if (event === 'SIGNED_OUT') setRecoveryMode(false);
      setReady(true);
    });
    supabase.auth.getSession().then(({ data }) => { setSession(data.session); setReady(true); });
    return () => listener.subscription.unsubscribe();
  }, [supabase]);

  useEffect(() => {
    const syncView = () => {
      const hash = window.location.hash.slice(1);
      if (hash === 'timer') setView('dashboard');
      if (hash === 'dashboard' || hash === 'entries' || hash === 'catalog' || hash === 'settings') setView(hash);
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

  const loadCatalog = useCallback(async () => {
    if (!session) return;
    try {
      const data = await request('/api/catalog');
      setProjects(data.projects); setTasks(data.tasks); setTags(data.tags);
      setTaskTotals(Object.fromEntries((data.totals ?? []).map((item: { task_id: string; seconds: number }) => [item.task_id, Number(item.seconds)])));
      setCatalogError(''); setCatalogReady(true);
    } catch (caught) {
      setCatalogError(caught instanceof Error ? caught.message : 'Could not load projects and tags');
      setCatalogReady(false);
    }
  }, [request, session]);

  const loadTagIds = useCallback(async (ids: string[]) => {
    if (!ids.length || !catalogReady) return;
    try {
      const batches = Array.from({ length: Math.ceil(ids.length / 100) }, (_unused, index) => ids.slice(index * 100, index * 100 + 100));
      const results = await Promise.all(batches.map((batch) => request(`/api/entry-tags?${new URLSearchParams({ ids: batch.join(',') })}`)));
      const byEntry = Object.assign({}, ...results.map((result) => result.tags_by_entry)) as Record<string, string[]>;
      setEntryTagIds((previous) => ({ ...previous, ...Object.fromEntries(ids.map((id) => [id, byEntry[id] ?? []])) }));
    } catch (caught) { setCatalogError(caught instanceof Error ? caught.message : 'Could not load entry tags'); }
  }, [request, catalogReady]);

  const refreshTimer = useCallback(async () => {
    if (!session) return;
    try {
      const data = await request('/api/timer');
      setEntry(data.entry);
      if (data.entry) void loadTagIds([data.entry.id]);
    } catch (caught) { setError(caught instanceof Error ? caught.message : 'Could not load timer'); }
  }, [request, session, loadTagIds]);

  const loadGoogleLinks = useCallback(async (ids: string[]) => {
    if (!ids.length) return;
    try {
      const data = await request(`/api/google/links?${new URLSearchParams({ ids: ids.slice(0, 100).join(',') })}`);
      setGoogleLinks((previous) => ({ ...previous, ...Object.fromEntries(data.links.filter((link: { html_link: string | null }) => link.html_link).map((link: { entry_id: string; html_link: string }) => [link.entry_id, link.html_link])) }));
    } catch { /* Calendar links are optional presentation metadata. */ }
  }, [request]);

  const loadEntries = useCallback(async () => {
    if (!session) return;
    const id = ++entryRequestId.current;
    setEntriesLoading(true);
    setEntriesError('');
    const params = new URLSearchParams({ page: String(page), page_size: String(pageSize) });
    if (search) params.set('q', search);
    if (projectFilter.trim()) params.set('project', projectFilter.trim());
    if (taskFilter.trim()) params.set('task', taskFilter.trim());
    if (tagFilter) params.set('tag_id', tagFilter);
    if (statusFilter !== 'all') params.set('status', statusFilter);
    if (fromDate) params.set('from', dateBoundary(fromDate));
    if (toDate) params.set('to', dateBoundary(toDate, true));
    try {
      const data = await request(`/api/entries?${params}`);
      if (id === entryRequestId.current) { setEntries(data.entries); setEntryCount(data.count); void loadTagIds(data.entries.map((item: TimeEntry) => item.id)); void loadGoogleLinks(data.entries.map((item: TimeEntry) => item.id)); }
    } catch (caught) {
      if (id === entryRequestId.current) setEntriesError(caught instanceof Error ? caught.message : 'Could not load entries');
    } finally {
      if (id === entryRequestId.current) setEntriesLoading(false);
    }
  }, [request, session, page, search, projectFilter, taskFilter, tagFilter, statusFilter, fromDate, toDate, loadTagIds, loadGoogleLinks]);

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
        void loadTagIds(data.entries.map((item: TimeEntry) => item.id));
        void loadGoogleLinks(data.entries.map((item: TimeEntry) => item.id));
      }
    } catch (caught) {
      if (id === timelineRequestId.current) setTimelineError(caught instanceof Error ? caught.message : 'Could not load timeline');
    } finally {
      if (id === timelineRequestId.current) setTimelineLoading(false);
    }
  }, [request, session, timelineDays, loadTagIds, loadGoogleLinks]);

  const refreshTokens = useCallback(async () => {
    if (!session) return;
    try {
      const data = await request('/api/tokens');
      setApiTokens(data.tokens);
    } catch (caught) { setError(caught instanceof Error ? caught.message : 'Could not load API tokens'); }
  }, [request, session]);

  const refreshCalendarSettings = useCallback(async () => {
    if (!session) return;
    try {
      const data = await request('/api/calendar/settings');
      const url = data.integration?.script_url ?? '';
      setCalendarUrl(url); setSavedCalendarUrl(url); setCalendarError('');
      setCalendarHasSecret(Boolean(data.has_secret));
    } catch (caught) { setCalendarError(caught instanceof Error ? caught.message : 'Could not load Calendar settings'); }
  }, [request, session]);

  const refreshCalendarSync = useCallback(async () => {
    if (!session) return;
    try {
      const data = await request('/api/calendar/sync');
      setCalendarPending(data.pending);
    } catch (caught) { setCalendarError(caught instanceof Error ? caught.message : 'Could not load Calendar sync status'); }
  }, [request, session]);

  const refreshGoogle = useCallback(async () => {
    if (!session) return;
    try {
      const [settings, sync] = await Promise.all([request('/api/google/settings'), request('/api/google/sync')]);
      setGoogleConnection(settings.connection);
      setGooglePending(sync.pending);
      setGoogleCalendars(settings.connection ? (await request('/api/google/calendars')).calendars : []);
      setGoogleError('');
    } catch (caught) { setGoogleError(caught instanceof Error ? caught.message : 'Could not load Google Calendar'); }
  }, [request, session]);

  useEffect(() => {
    if (!session) return;
    const params = new URLSearchParams(window.location.search);
    if (params.has('google_error')) setGoogleError(params.get('google_error') || 'Google connection failed');
    else if (params.get('google') === 'connected') { setNotice('Google Calendar connected'); void refreshGoogle(); }
    if (params.has('google') || params.has('google_error')) window.history.replaceState(null, '', `${window.location.pathname}${window.location.hash}`);
  }, [session, refreshGoogle]);

  useEffect(() => {
    if (!session) { setEntry(null); setEntries([]); setTimelineEntries([]); setProjects([]); setTasks([]); setTaskTotals({}); setCatalogReady(false); setEntryTagIds({}); setApiTokens([]); setNewToken(''); setCalendarUrl(''); setSavedCalendarUrl(''); setCalendarSecret(''); setCalendarHasSecret(false); setCalendarError(''); setCalendarPending([]); setGoogleConnection(null); setGoogleCalendars([]); setGooglePending([]); setGoogleLinks({}); entryRequestId.current += 1; timelineRequestId.current += 1; return; }
    void refreshTimer();
    void refreshTokens();
    void refreshCalendarSettings();
    void refreshCalendarSync();
    void refreshGoogle();
    const ticker = window.setInterval(() => setNow(Date.now()), 1000);
    const sync = window.setInterval(() => void refreshTimer(), 30000);
    const onFocus = () => void refreshTimer();
    window.addEventListener('focus', onFocus);
    return () => { window.clearInterval(ticker); window.clearInterval(sync); window.removeEventListener('focus', onFocus); };
  }, [session, refreshTimer, refreshTokens, refreshCalendarSettings, refreshCalendarSync, refreshGoogle]);

  useEffect(() => {
    if (!session) return;
    void loadCatalog();
    const onFocus = () => void loadCatalog();
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [session, loadCatalog]);

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
    setSearchInput(''); setSearch(''); setProjectFilter(''); setTaskFilter(''); setTagFilter(''); setStatusFilter('all');
    setFromDate(''); setToDate(''); setPage(1);
  }

  function categoryPayload(projectKey: string, taskKey: string) {
    const selectedProject = projects.find((item) => !item.archived && item.key === projectKey);
    const selectedTask = tasks.find((item) => !item.archived && item.project_id === selectedProject?.id && item.key === taskKey);
    return selectedProject && (!taskKey || selectedTask)
      ? { project_id: selectedProject.id, task_id: selectedTask?.id ?? '' }
      : {};
  }

  function projectLabel(key: string) {
    return projects.find((item) => item.key === key)?.name ?? key;
  }

  function taskLabel(projectKey: string, key: string) {
    const projectId = projects.find((item) => item.key === projectKey)?.id;
    return tasks.find((item) => item.project_id === projectId && item.key === key)?.name ?? key;
  }

  function taskPath(item: TaskRecord) {
    const names = [item.name];
    const visited = new Set([item.id]);
    let parentId = item.parent_task_id;
    while (parentId && !visited.has(parentId)) {
      const parent = tasks.find((record) => record.id === parentId && record.project_id === item.project_id);
      if (!parent) break;
      names.unshift(parent.name);
      visited.add(parent.id);
      parentId = parent.parent_task_id;
    }
    return names.join(' / ');
  }

  function taskDescendants(id: string) {
    const descendants = new Set([id]);
    let changed = true;
    while (changed) {
      changed = false;
      for (const candidate of tasks) {
        if (candidate.parent_task_id && descendants.has(candidate.parent_task_id) && !descendants.has(candidate.id)) {
          descendants.add(candidate.id); changed = true;
        }
      }
    }
    return descendants;
  }

  function taskTree(projectId: string, parentId: string | null = null, visited = new Set<string>()): React.ReactNode {
    return tasks.filter((item) => item.project_id === projectId &&
      (item.parent_task_id === parentId || (parentId === null && !tasks.some((parent) => parent.id === item.parent_task_id && parent.project_id === projectId))))
      .sort((a, b) => a.name.localeCompare(b.name)).map((item) => {
        if (visited.has(item.id)) return null;
        const next = new Set(visited); next.add(item.id);
        return <Box key={item.id} sx={{ borderTop: 1, borderColor: 'divider', py: 1, pl: parentId ? 2 : 0 }}>
          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} sx={{ alignItems: { sm: 'center' }, justifyContent: 'space-between' }}>
            <Box><Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}><Typography sx={{ fontWeight: 600 }}>{item.name}</Typography><Chip size="small" variant="outlined" label={item.issue_type} />{item.archived && <Chip size="small" label="Archived" />}</Stack><Typography variant="body2" color="text.secondary">{item.key} · {duration(taskTotals[item.id] ?? 0)} direct · {duration([...taskDescendants(item.id)].reduce((total, taskId) => total + (taskTotals[taskId] ?? 0), 0))} with children</Typography></Box>
            <Stack direction="row" spacing={1}><Button size="small" onClick={() => { openCatalog('task'); setCatalogProjectId(projectId); setCatalogParentTaskId(item.id); setCatalogIssueType('Subtask'); }}>Add child</Button><Button size="small" onClick={() => openCatalog('task', 'catalog', item)}>Edit</Button><Button size="small" onClick={() => void changeCatalogState('task', item.id, item.archived)} disabled={busy}>{item.archived ? 'Restore' : 'Archive'}</Button></Stack>
          </Stack>{taskTree(projectId, item.id, next)}
        </Box>;
      });
  }

  function entryTags(id: string) {
    return tags.filter((item) => (entryTagIds[id] ?? []).includes(item.id));
  }

  function openCatalog(kind: CatalogKind, target: typeof catalogTarget = 'catalog', item?: ProjectRecord | TaskRecord | TagRecord) {
    setCatalogTarget(target); setCatalogDialog({ kind, item }); setCatalogDialogError('');
    setCatalogName(item?.name ?? '');
    setCatalogKey(item && 'key' in item ? item.key : '');
    setCatalogColor(item && 'color' in item ? item.color : kind === 'tag' ? '#757575' : '#1976d2');
    const targetProject = target === 'timer' ? project : target === 'manual' ? manualProject : target === 'edit' ? editProject : '';
    setCatalogProjectId(item && 'project_id' in item ? item.project_id : projects.find((record) => record.key === targetProject)?.id ?? '');
    setCatalogParentTaskId(item && 'parent_task_id' in item ? item.parent_task_id ?? '' : '');
    setCatalogIssueType(item && 'issue_type' in item ? item.issue_type : 'Task');
  }

  async function saveCatalog(event: React.FormEvent) {
    event.preventDefault();
    if (!catalogDialog) return;
    setBusy(true); setCatalogDialogError('');
    try {
      const { kind, item } = catalogDialog;
      const payload = item
        ? { name: catalogName, ...(kind === 'task' ? { parent_task_id: catalogParentTaskId || null, issue_type: catalogIssueType } : { color: catalogColor }) }
        : { kind, name: catalogName, key: catalogKey || undefined, project_id: catalogProjectId || undefined, ...(kind === 'task' ? { parent_task_id: catalogParentTaskId || null, issue_type: catalogIssueType } : { color: catalogColor }) };
      const data = await request(item ? `/api/catalog/${kind}s/${item.id}` : '/api/catalog', { method: item ? 'PATCH' : 'POST', body: JSON.stringify(payload) });
      if (!item) {
        if (kind === 'project') {
          if (catalogTarget === 'timer') { setProject(data.item.key); setTask(''); }
          if (catalogTarget === 'manual') { setManualProject(data.item.key); setManualTask(''); }
          if (catalogTarget === 'edit') { setEditProject(data.item.key); setEditTask(''); }
        }
        if (kind === 'task') {
          const parent = projects.find((record) => record.id === data.item.project_id);
          if (catalogTarget === 'timer') { setProject(parent?.key ?? ''); setTask(data.item.key); }
          if (catalogTarget === 'manual') { setManualProject(parent?.key ?? ''); setManualTask(data.item.key); }
          if (catalogTarget === 'edit') { setEditProject(parent?.key ?? ''); setEditTask(data.item.key); }
        }
        if (kind === 'tag') {
          if (catalogTarget === 'timer') setStartTagIds((ids) => [...ids, data.item.id]);
          if (catalogTarget === 'manual') setManualTagIds((ids) => [...ids, data.item.id]);
          if (catalogTarget === 'edit') setEditTagIds((ids) => [...ids, data.item.id]);
        }
      }
      setCatalogDialog(null);
      setNotice(`${kind[0].toUpperCase()}${kind.slice(1)} ${item ? 'updated' : 'created'}`);
      await loadCatalog();
    } catch (caught) { setCatalogDialogError(caught instanceof Error ? caught.message : 'Could not save item'); }
    finally { setBusy(false); }
  }

  async function changeCatalogState(kind: CatalogKind, id: string, archived: boolean) {
    setBusy(true); setError('');
    try {
      await request(`/api/catalog/${kind}s/${id}`, { method: archived ? 'PATCH' : 'DELETE', ...(archived ? { body: JSON.stringify({ archived: false }) } : {}) });
      if (kind === 'tag') setTagFilter((current) => current === id ? '' : current);
      await loadCatalog();
      setNotice(archived ? 'Item restored' : kind === 'tag' ? 'Tag deleted' : 'Item archived');
      return true;
    } catch (caught) { setError(caught instanceof Error ? caught.message : 'Could not update item'); return false; }
    finally { setBusy(false); }
  }

  async function importCatalog() {
    setBusy(true); setError('');
    try {
      const result = await request('/api/catalog/import', { method: 'POST' });
      await loadCatalog();
      setNotice(`Imported ${result.projects_created} projects and ${result.tasks_created} tasks from existing entries`);
    } catch (caught) { setError(caught instanceof Error ? caught.message : 'Could not import existing entries'); }
    finally { setBusy(false); }
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

  async function saveCalendarSettings(event: React.FormEvent) {
    event.preventDefault(); setBusy(true); setCalendarError(''); setNotice('');
    try {
      const data = await request('/api/calendar/settings', { method: 'PUT', body: JSON.stringify({ script_url: calendarUrl, ...(calendarSecret ? { webhook_secret: calendarSecret } : {}) }) });
      setCalendarUrl(data.integration.script_url);
      setSavedCalendarUrl(data.integration.script_url);
      setCalendarSecret('');
      setCalendarHasSecret(Boolean(data.has_secret));
      setNotice('Google Calendar connection saved');
    } catch (caught) { setCalendarError(caught instanceof Error ? caught.message : 'Could not save Calendar URL'); }
    finally { setBusy(false); }
  }

  async function disconnectCalendar() {
    setBusy(true); setCalendarError(''); setNotice('');
    try {
      await request('/api/calendar/settings', { method: 'DELETE' });
      setCalendarUrl(''); setSavedCalendarUrl(''); setCalendarSecret(''); setCalendarHasSecret(false);
      setNotice('Google Calendar disconnected');
    } catch (caught) { setCalendarError(caught instanceof Error ? caught.message : 'Could not disconnect Calendar'); }
    finally { setBusy(false); }
  }

  async function retryCalendarSync() {
    setBusy(true); setCalendarError(''); setNotice('');
    try {
      const data = await request('/api/calendar/sync', { method: 'POST' });
      await refreshCalendarSync();
      setNotice(`Synced ${data.synced} of ${data.attempted} pending Calendar changes`);
    } catch (caught) { setCalendarError(caught instanceof Error ? caught.message : 'Could not retry Calendar sync'); }
    finally { setBusy(false); }
  }

  async function connectGoogle() {
    setBusy(true); setGoogleError('');
    try {
      const data = await request('/api/google/connect', { method: 'POST' });
      window.location.assign(data.url);
    } catch (caught) { setGoogleError(caught instanceof Error ? caught.message : 'Could not connect Google Calendar'); setBusy(false); }
  }

  async function selectGoogleCalendar(calendarId: string) {
    setBusy(true); setGoogleError('');
    try {
      const data = await request('/api/google/settings', { method: 'PATCH', body: JSON.stringify({ calendar_id: calendarId }) });
      setGoogleConnection(data.connection);
      setNotice('Calendar selected for new entries');
    } catch (caught) { setGoogleError(caught instanceof Error ? caught.message : 'Could not select Calendar'); }
    finally { setBusy(false); }
  }

  async function createCalendar(event: React.FormEvent) {
    event.preventDefault(); setBusy(true); setGoogleError('');
    try {
      const data = await request('/api/google/calendars', { method: 'POST', body: JSON.stringify({ name: googleCalendarName.trim() }) });
      setGoogleConnection(data.connection);
      setGoogleCalendarDialog(false); setGoogleCalendarName('');
      setNotice(`Created and selected ${data.calendar.summary}`);
      void refreshGoogle();
    } catch (caught) { setGoogleError(caught instanceof Error ? caught.message : 'Could not create Calendar'); }
    finally { setBusy(false); }
  }

  async function disconnectGoogle() {
    setBusy(true); setGoogleError('');
    try {
      await request('/api/google/settings', { method: 'DELETE' });
      setGoogleConnection(null); setGoogleCalendars([]);
      setNotice('Direct Google Calendar connection removed');
    } catch (caught) { setGoogleError(caught instanceof Error ? caught.message : 'Could not disconnect Google Calendar'); }
    finally { setBusy(false); }
  }

  async function retryGoogleSync() {
    setBusy(true); setGoogleError('');
    try {
      const data = await request('/api/google/sync', { method: 'POST' });
      await refreshGoogle();
      setNotice(`Synced ${data.synced} of ${data.attempted} direct Calendar changes`);
    } catch (caught) { setGoogleError(caught instanceof Error ? caught.message : 'Could not retry Google Calendar sync'); }
    finally { setBusy(false); }
  }

  async function authenticate(event: React.FormEvent) {
    event.preventDefault(); setBusy(true); setError(''); setNotice('');
    try {
      if (mode === 'forgot') {
        const { error } = await supabase.auth.resetPasswordForEmail(email.trim());
        if (error) throw error;
        setNotice('If an account exists for this email, a password reset link is on its way.');
      } else if (mode === 'login') {
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

  async function finishPasswordRecovery(event: React.FormEvent) {
    event.preventDefault(); setBusy(true); setError(''); setNotice('');
    try {
      if (!session) throw new Error('This reset link is expired or invalid. Request a new one.');
      if (recoveryPassword.length < 8) throw new Error('Use at least 8 characters for your new password');
      if (recoveryPassword !== recoveryConfirm) throw new Error('New passwords do not match');
      const { error } = await supabase.auth.updateUser({ password: recoveryPassword });
      if (error) throw error;
      setRecoveryPassword(''); setRecoveryConfirm(''); setPassword(''); setMode('login');
      window.history.replaceState(null, '', `${window.location.pathname}${window.location.search}`);
      const { error: signOutError } = await supabase.auth.signOut();
      setRecoveryMode(false);
      setNotice(signOutError ? 'Password updated. Sign out, then sign in with your new password.' : 'Password updated. Sign in with your new password.');
    } catch (caught) { setError(caught instanceof Error ? caught.message : 'Could not update password'); }
    finally { setBusy(false); }
  }

  async function changeAccountPassword(event: React.FormEvent) {
    event.preventDefault(); setBusy(true); setChangeError(''); setNotice('');
    try {
      if (newPassword.length < 8) throw new Error('Use at least 8 characters for your new password');
      if (newPassword !== confirmPassword) throw new Error('New passwords do not match');
      if (newPassword === currentPassword) throw new Error('Choose a different password');
      if (!session?.user.email) throw new Error('This account has no email password to change');
      const verifier = passwordCheckClient(supabaseUrl, supabaseAnonKey);
      const { data: verified, error: verifyError } = await verifier.auth.signInWithPassword({ email: session.user.email, password: currentPassword });
      if (verifyError || verified.user?.id !== session.user.id) throw new Error('Current password is incorrect');
      await verifier.auth.signOut({ scope: 'local' });
      const { error } = await supabase.auth.updateUser({
        password: newPassword, current_password: currentPassword,
        ...(changeNonce ? { nonce: changeNonce.trim() } : {}),
      });
      if (error) throw error;
      setCurrentPassword(''); setNewPassword(''); setConfirmPassword(''); setChangeNonce(''); setChangeCodeSent(false);
      setNotice('Password changed');
    } catch (caught) { setChangeError(caught instanceof Error ? caught.message : 'Could not change password'); }
    finally { setBusy(false); }
  }

  async function sendPasswordChangeCode() {
    setBusy(true); setChangeError('');
    try {
      const { error } = await supabase.auth.reauthenticate();
      if (error) throw error;
      setChangeCodeSent(true);
      setNotice('A verification code was sent to your email');
    } catch (caught) { setChangeError(caught instanceof Error ? caught.message : 'Could not send verification code'); }
    finally { setBusy(false); }
  }

  async function timerAction(action: 'start' | 'pause' | 'resume' | 'stop') {
    setBusy(true); setError(''); setNotice('');
    try {
      const body = action === 'start' ? { action, project, task, description, ...categoryPayload(project, task), ...(catalogReady ? { tag_ids: startTagIds } : {}) } : { action };
      const result = await request('/api/timer', { method: 'POST', body: JSON.stringify(body) });
      await Promise.all([refreshTimer(), loadEntries(), loadTimeline()]);
      if (action === 'stop') {
        void refreshCalendarSync();
        if (result.calendar_sync?.status === 'failed') setNotice('Timer stopped. Calendar sync failed; retry it in Settings.');
      }
      if (action === 'start') setStartTagIds([]);
    } catch (caught) { setError(caught instanceof Error ? caught.message : 'Timer action failed'); }
    finally { setBusy(false); }
  }

  async function createManual(event: React.FormEvent) {
    event.preventDefault(); setBusy(true); setError(''); setNotice('');
    try {
      const start = combineDateAndTime(manualStartDate, manualStartTime);
      const end = combineDateAndTime(manualEndDate, manualEndTime);
      if (!start || !end || !end.isAfter(start)) throw new Error('Choose valid start and end dates and times, with the end after the start');
      const result = await request('/api/entries', { method: 'POST', body: JSON.stringify({
        project: manualProject, task: manualTask, description: manualDescription,
        ...categoryPayload(manualProject, manualTask), ...(catalogReady ? { tag_ids: manualTagIds } : {}),
        start_at: start.toDate().toISOString(), end_at: end.toDate().toISOString(),
      }) });
      setNotice(result.calendar_sync?.status === 'failed' ? 'Time entry added. Calendar sync failed; retry it in Settings.' : 'Time entry added');
      void refreshCalendarSync();
      setManualDescription('');
      setManualTagIds([]);
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
    const start = dayjs(item.start_at);
    const end = item.end_at ? dayjs(item.end_at) : null;
    setEditStartDate(start); setEditStartTime(start);
    setEditEndDate(end); setEditEndTime(end);
    setEditTagIds(entryTagIds[item.id] ?? []);
    setEditingEntry(item);
  }

  async function updateEntry(event: React.FormEvent) {
    event.preventDefault();
    if (!editingEntry) return;
    setBusy(true); setEntryDialogError(''); setNotice('');
    try {
      const start = combineDateAndTime(editStartDate, editStartTime);
      const end = combineDateAndTime(editEndDate, editEndTime);
      if (editingEntry.status === 'stopped' && (!start || !end)) throw new Error('Choose valid start and end dates and times');
      const startChanged = editingEntry.status === 'stopped' && start?.format('YYYY-MM-DDTHH:mm') !== dayjs(editingEntry.start_at).format('YYYY-MM-DDTHH:mm');
      const endChanged = editingEntry.status === 'stopped' && !!editingEntry.end_at && end?.format('YYYY-MM-DDTHH:mm') !== dayjs(editingEntry.end_at).format('YYYY-MM-DDTHH:mm');
      if ((startChanged || endChanged) && (!start || !end || !end.isAfter(start))) throw new Error('End must be after the start');
      const result = await request(`/api/entries/${editingEntry.id}`, { method: 'PATCH', body: JSON.stringify({
        project: editProject, task: editTask, description: editDescription,
        ...categoryPayload(editProject, editTask), ...(catalogReady ? { tag_ids: editTagIds } : {}),
        ...(startChanged ? { start_at: start!.toDate().toISOString() } : {}),
        ...(endChanged ? { end_at: end!.toDate().toISOString() } : {}),
      }) });
      setEditingEntry(null);
      setNotice(result.calendar_sync?.status === 'failed' ? 'Time entry updated. Calendar sync failed; retry it in Settings.' : 'Time entry updated');
      void refreshCalendarSync();
      await Promise.all([refreshTimer(), loadEntries(), loadTimeline()]);
    } catch (caught) { setEntryDialogError(caught instanceof Error ? caught.message : 'Could not update entry'); }
    finally { setBusy(false); }
  }

  async function deleteEntry() {
    if (!deletingEntry) return;
    setBusy(true); setEntryDialogError(''); setNotice('');
    try {
      const result = await request(`/api/entries/${deletingEntry.id}`, { method: 'DELETE' });
      setDeletingEntry(null);
      setSelectedTimelineEntry(null);
      setNotice(result.calendar_sync?.status === 'failed' ? 'Time entry deleted. Calendar sync failed; retry it in Settings.' : 'Time entry deleted');
      void refreshCalendarSync();
      if (page > 1 && entries.length === 1) setPage(page - 1);
      else await loadEntries();
      await Promise.all([refreshTimer(), loadTimeline()]);
    } catch (caught) { setEntryDialogError(caught instanceof Error ? caught.message : 'Could not delete entry'); }
    finally { setBusy(false); }
  }

  if (!ready) return <Box sx={{ minHeight: '100vh', display: 'grid', placeItems: 'center' }}><CircularProgress aria-label="Loading Timelogger" /></Box>;

  if (recoveryMode) return <Box sx={{ minHeight: '100vh', display: 'grid', placeItems: 'center', bgcolor: 'grey.50', p: 2 }}>
    <Card sx={{ width: '100%', maxWidth: 440, borderRadius: 3, boxShadow: 3 }}><CardContent sx={{ p: { xs: 3, sm: 4 } }}><Stack spacing={3}>
      <Box><Typography variant="h4" sx={{ fontWeight: 700 }}>Timelogger</Typography><Typography color="text.secondary">Reset your password</Typography></Box>
      {error && <Alert severity="error">{error}</Alert>}
      {session ? <Box component="form" onSubmit={finishPasswordRecovery}><Stack spacing={2}>
        <TextField label="New password" type="password" value={recoveryPassword} onChange={(event) => setRecoveryPassword(event.target.value)} required fullWidth autoComplete="new-password" slotProps={{ htmlInput: { minLength: 8 } }} />
        <TextField label="Confirm new password" type="password" value={recoveryConfirm} onChange={(event) => setRecoveryConfirm(event.target.value)} required fullWidth autoComplete="new-password" slotProps={{ htmlInput: { minLength: 8 } }} />
        <Button variant="contained" size="large" type="submit" disabled={busy}>Set new password</Button>
      </Stack></Box> : <><Alert severity="warning">This reset link could not be verified. Request a new link and try again.</Alert><Button onClick={() => { setRecoveryMode(false); setMode('forgot'); setError(''); }}>Request another link</Button></>}
    </Stack></CardContent></Card>
  </Box>;

  if (!session) return <Box sx={{ minHeight: '100vh', display: 'grid', placeItems: 'center', bgcolor: 'grey.50', p: 2 }}>
    <Card sx={{ width: '100%', maxWidth: 440, borderRadius: 3, boxShadow: 3 }}><CardContent sx={{ p: { xs: 3, sm: 4 } }}>
      <Stack spacing={3}>
        <Box><Typography variant="h4" sx={{ fontWeight: 700 }}>Timelogger</Typography><Typography color="text.secondary">Your time, clearly accounted for.</Typography></Box>
        <Typography variant="h6">{mode === 'login' ? 'Sign in' : mode === 'signup' ? 'Create an account' : 'Forgot your password?'}</Typography>
        {error && <Alert severity="error">{error}</Alert>}
        {notice && <Alert severity="success">{notice}</Alert>}
        <Box component="form" onSubmit={authenticate}><Stack spacing={2}>
          <TextField label="Email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required fullWidth autoComplete="email" />
          {mode !== 'forgot' && <TextField label="Password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} required fullWidth autoComplete={mode === 'login' ? 'current-password' : 'new-password'} slotProps={{ htmlInput: { minLength: 6 } }} />}
          <Button variant="contained" size="large" type="submit" disabled={busy}>{mode === 'login' ? 'Sign in' : mode === 'signup' ? 'Sign up' : 'Send reset link'}</Button>
        </Stack></Box>
        {mode === 'login' ? <Stack><Button onClick={() => { setMode('forgot'); setError(''); setNotice(''); }}>Forgot password?</Button><Button onClick={() => { setMode('signup'); setError(''); setNotice(''); }}>Need an account? Sign up</Button></Stack>
          : <Button onClick={() => { setMode('login'); setError(''); setNotice(''); }}>Back to sign in</Button>}
      </Stack>
    </CardContent></Card>
  </Box>;

  return <LocalizationProvider dateAdapter={AdapterDayjs}><Box sx={{ minHeight: '100vh', bgcolor: 'grey.50' }}>
    <AppBar position="sticky" elevation={0}><Toolbar><Typography variant="h6" sx={{ flexGrow: 1, fontWeight: 700 }}>Timelogger</Typography><Typography variant="body2" sx={{ display: { xs: 'none', sm: 'block' }, mr: 2 }}>{session.user.email}</Typography><Button color="inherit" onClick={() => void supabase.auth.signOut()}>Sign out</Button></Toolbar></AppBar>
    <Container maxWidth="lg" component="main" sx={{ py: { xs: 2, sm: 4 } }}><Stack spacing={3}>
      <Paper variant="outlined" sx={{ borderRadius: 3, overflow: 'hidden' }}><Tabs value={view} onChange={(_event, next: View) => navigate(next)} variant="scrollable" scrollButtons="auto" aria-label="Timelogger sections"><Tab label="Dashboard" value="dashboard" id="tab-dashboard" aria-controls="panel-dashboard" /><Tab label="Time entries" value="entries" id="tab-entries" aria-controls="panel-entries" /><Tab label="Projects & tags" value="catalog" id="tab-catalog" aria-controls="panel-catalog" /><Tab label="Settings" value="settings" id="tab-settings" aria-controls="panel-settings" /></Tabs></Paper>
      {error && <Alert severity="error" onClose={() => setError('')}>{error}</Alert>}
      {notice && <Alert severity="success" onClose={() => setNotice('')}>{notice}</Alert>}
      {catalogError && <Alert severity="warning" onClose={() => setCatalogError('')}>Projects, tasks, and tags are unavailable: {catalogError}. Apply <code>supabase/catalog.sql</code> to enable v0.5.</Alert>}
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
            {catalogReady ? <TextField select label="Project" value={entry ? entry.project : project} onChange={(e) => { setProject(e.target.value); setTask(''); }} disabled={!!entry} size="small" sx={{ flex: 1 }}><MenuItem value="">No project</MenuItem>{projects.filter((item) => !item.archived).map((item) => <MenuItem key={item.id} value={item.key}>{item.name} ({item.key})</MenuItem>)}{(entry ? entry.project : project) && !projects.some((item) => item.key === (entry ? entry.project : project)) && <MenuItem value={entry ? entry.project : project}>{entry ? entry.project : project} (legacy)</MenuItem>}</TextField> : <TextField label="Project" value={entry ? entry.project : project} onChange={(e) => setProject(e.target.value)} disabled={!!entry} size="small" sx={{ flex: 1 }} slotProps={{ htmlInput: { maxLength: 500 } }} />}
            {catalogReady ? <TextField select label="Task" value={entry ? entry.task : task} onChange={(e) => setTask(e.target.value)} disabled={!!entry} size="small" sx={{ flex: 1 }}><MenuItem value="">No task</MenuItem>{tasks.filter((item) => !item.archived && item.project_id === projects.find((record) => record.key === (entry ? entry.project : project))?.id).map((item) => <MenuItem key={item.id} value={item.key}>{taskPath(item)} ({item.key})</MenuItem>)}{(entry ? entry.task : task) && !tasks.some((item) => item.key === (entry ? entry.task : task) && item.project_id === projects.find((record) => record.key === (entry ? entry.project : project))?.id) && <MenuItem value={entry ? entry.task : task}>{entry ? entry.task : task} (legacy)</MenuItem>}</TextField> : <TextField label="Task" value={entry ? entry.task : task} onChange={(e) => setTask(e.target.value)} disabled={!!entry} size="small" sx={{ flex: 1 }} slotProps={{ htmlInput: { maxLength: 500 } }} />}
            {entry && <Chip label={entry.status === 'running' ? 'Running' : 'Paused'} color={entry.status === 'running' ? 'success' : 'warning'} sx={{ alignSelf: 'center' }} />}
            {!entry && catalogReady && <><Button onClick={() => openCatalog('project', 'timer')}>New project</Button><Button onClick={() => openCatalog('task', 'timer')} disabled={!projects.some((item) => item.key === project)}>New task</Button></>}
            <Button onClick={() => setManualDialogOpen(true)}>Add time manually</Button>
          </Stack>
          {catalogReady && <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}><Autocomplete multiple size="small" options={tags} getOptionLabel={(option) => option.name} value={tags.filter((item) => (entry ? entryTagIds[entry.id] ?? [] : startTagIds).includes(item.id))} onChange={(_event, value) => setStartTagIds(value.map((item) => item.id))} disabled={!!entry} renderInput={(params) => <TextField {...params} label="Tags" placeholder="Choose tags" />} sx={{ flex: 1 }} />{!entry && <Button onClick={() => openCatalog('tag', 'timer')}>New tag</Button>}{entry && <Button onClick={() => openEdit(entry)}>Edit entry</Button>}</Stack>}
        </Stack></Paper>
        <Paper variant="outlined" sx={{ borderRadius: 3, overflow: 'hidden' }}><Stack>
          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} sx={{ p: 2, alignItems: { sm: 'center' }, justifyContent: 'space-between' }}>
            <Box><Typography variant="h5" sx={{ fontWeight: 700 }}>Timeline</Typography><Typography variant="body2" color="text.secondary">{timelineMode === 'week' ? `${timelineDays[0].toLocaleDateString(undefined, { month: 'short', day: 'numeric' })} – ${timelineDays[6].toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}` : timelineDays[0].toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric', year: 'numeric' })}</Typography></Box>
            <Stack direction="row" spacing={1} sx={{ flexWrap: 'wrap', alignItems: 'center' }}>
              <Button aria-label="Previous period" onClick={() => setTimelineAnchor(addDays(timelineAnchor, timelineMode === 'week' ? -7 : -1))}>‹</Button>
              <Button onClick={() => setTimelineAnchor(new Date())}>Today</Button>
              <Button aria-label="Next period" onClick={() => setTimelineAnchor(addDays(timelineAnchor, timelineMode === 'week' ? 7 : 1))}>›</Button>
              <DatePicker label="Go to date" value={dayjs(timelineAnchor)} onChange={(value) => { if (value?.isValid()) setTimelineAnchor(value.hour(12).toDate()); }} slotProps={{ textField: { size: 'small', sx: { width: 170 } } }} />
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
                {layoutDay(timelineEntries, day, now).map((segment) => <Tooltip key={segment.entry.id} title={`${taskLabel(segment.entry.project, segment.entry.task) || segment.entry.description || 'Untitled work'} · ${duration(currentDuration(segment.entry, now))}`}><ButtonBase onClick={() => setSelectedTimelineEntry(segment.entry)} sx={{ position: 'absolute', top: segment.startMinute * hourHeight / 60, height: Math.max(20, (segment.endMinute - segment.startMinute) * hourHeight / 60), left: `calc(${segment.lane * 100 / segment.laneCount}% + 2px)`, width: `calc(${100 / segment.laneCount}% - 4px)`, bgcolor: segment.entry.status === 'running' ? 'success.light' : segment.entry.status === 'paused' ? 'warning.light' : 'primary.light', borderLeft: 3, borderColor: projects.find((item) => item.key === segment.entry.project)?.color ?? (segment.entry.status === 'running' ? 'success.main' : segment.entry.status === 'paused' ? 'warning.main' : 'primary.main'), borderRadius: 1, px: 0.5, overflow: 'hidden', textAlign: 'left', alignItems: 'flex-start', justifyContent: 'flex-start', zIndex: 1 }}><Typography variant="caption" sx={{ fontWeight: 700, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: 'text.primary' }}>{taskLabel(segment.entry.project, segment.entry.task) || segment.entry.description || 'Untitled work'}</Typography></ButtonBase></Tooltip>)}
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
            <Grid size={{ xs: 12, sm: 6, md: 3 }}><TextField label="Task contains" value={taskFilter} onChange={(e) => { setTaskFilter(e.target.value); setPage(1); }} fullWidth slotProps={{ htmlInput: { maxLength: 100 } }} /></Grid>
            {catalogReady && <Grid size={{ xs: 12, sm: 6, md: 3 }}><TextField select label="Tag" value={tagFilter} onChange={(e) => { setTagFilter(e.target.value); setPage(1); }} fullWidth><MenuItem value="">All tags</MenuItem>{tags.map((item) => <MenuItem key={item.id} value={item.id}>{item.name}</MenuItem>)}</TextField></Grid>}
            <Grid size={{ xs: 12, sm: 6, md: 3 }}><TextField select label="Status" value={statusFilter} onChange={(e) => { setStatusFilter(e.target.value as StatusFilter); setPage(1); }} fullWidth><MenuItem value="all">All statuses</MenuItem><MenuItem value="running">Running</MenuItem><MenuItem value="paused">Paused</MenuItem><MenuItem value="stopped">Stopped</MenuItem></TextField></Grid>
            <Grid size={{ xs: 12, sm: 6, md: 3 }}><TextField label="From date" type="date" value={fromDate} onChange={(e) => { setFromDate(e.target.value); setPage(1); }} fullWidth slotProps={{ inputLabel: { shrink: true } }} /></Grid>
            <Grid size={{ xs: 12, sm: 6, md: 3 }}><TextField label="To date" type="date" value={toDate} onChange={(e) => { setToDate(e.target.value); setPage(1); }} fullWidth slotProps={{ inputLabel: { shrink: true } }} /></Grid>
          </Grid>
          <Box><Button onClick={clearFilters} disabled={!searchInput && !projectFilter && !taskFilter && !tagFilter && statusFilter === 'all' && !fromDate && !toDate}>Clear filters</Button></Box>
        </Stack></Paper>
        <Paper variant="outlined" sx={{ borderRadius: 3, overflow: 'hidden' }}><Stack>
          <Box sx={{ p: { xs: 2, sm: 3 }, display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 2 }}><Typography variant="h6" sx={{ fontWeight: 700 }}>Results</Typography><Typography variant="body2" color="text.secondary" aria-live="polite">{entriesLoading ? 'Loading…' : `${entryCount} ${entryCount === 1 ? 'entry' : 'entries'}`}</Typography></Box>
          <Divider />
          {entriesError && <Alert severity="error" sx={{ m: 2 }} action={<Button color="inherit" size="small" onClick={() => void loadEntries()}>Retry</Button>}>{entriesError}</Alert>}
          {entriesLoading && <Box sx={{ display: 'grid', placeItems: 'center', py: 6 }}><CircularProgress aria-label="Loading entries" /></Box>}
          {!entriesLoading && !entriesError && entries.length === 0 && <Box sx={{ p: 4, textAlign: 'center' }}><Typography variant="h6">No entries found</Typography><Typography color="text.secondary">{search || projectFilter || taskFilter || tagFilter || statusFilter !== 'all' || fromDate || toDate ? 'Try another search or clear the filters.' : 'Start a timer or add time manually to see it here.'}</Typography>{!search && !projectFilter && !taskFilter && !tagFilter && statusFilter === 'all' && !fromDate && !toDate && <Button sx={{ mt: 2 }} onClick={() => navigate('dashboard')}>Go to dashboard</Button>}</Box>}
          {!entriesLoading && !entriesError && entries.length > 0 && <>
            <TableContainer sx={{ display: { xs: 'none', md: 'block' } }}><Table aria-label="Time entries"><TableHead><TableRow><TableCell>Work and actions</TableCell><TableCell>Project</TableCell><TableCell>Started</TableCell><TableCell>Status</TableCell><TableCell align="right">Duration</TableCell></TableRow></TableHead><TableBody>
              {entries.map((item) => <TableRow key={item.id} hover><TableCell><Typography sx={{ fontWeight: 600 }}>{taskLabel(item.project, item.task) || 'Untitled work'}</Typography>{item.description && <Typography variant="body2" color="text.secondary">{item.description}</Typography>}{entryTags(item.id).map((tag) => <Chip key={tag.id} size="small" label={tag.name} sx={{ mr: 0.5, mt: 0.5, bgcolor: tag.color, color: 'white' }} />)}<Stack direction="row" spacing={0.5} sx={{ mt: 0.5 }}>{googleLinks[item.id] && <Button size="small" href={googleLinks[item.id]} target="_blank" rel="noopener noreferrer">Calendar event</Button>}<Button size="small" onClick={() => openEdit(item)} aria-label={`Edit ${item.task || 'time entry'}`}>Edit</Button><Button size="small" color="error" onClick={() => { setEntryDialogError(''); setDeletingEntry(item); }} aria-label={`Delete ${item.task || 'time entry'}`}>Delete</Button></Stack></TableCell><TableCell>{projectLabel(item.project) || '—'}</TableCell><TableCell>{new Date(item.start_at).toLocaleString()}</TableCell><TableCell><Chip size="small" label={item.status} color={item.status === 'running' ? 'success' : item.status === 'paused' ? 'warning' : 'default'} /></TableCell><TableCell align="right" sx={{ fontVariantNumeric: 'tabular-nums', fontWeight: 600 }}>{duration(currentDuration(item, now))}</TableCell></TableRow>)}
            </TableBody></Table></TableContainer>
            <Stack divider={<Divider />} sx={{ display: { xs: 'flex', md: 'none' } }}>{entries.map((item) => <Box key={item.id} sx={{ p: 2 }}><Stack direction="row" spacing={2} sx={{ justifyContent: 'space-between', alignItems: 'flex-start' }}><Box><Typography sx={{ fontWeight: 600 }}>{taskLabel(item.project, item.task) || 'Untitled work'}</Typography><Typography variant="body2" color="text.secondary">{projectLabel(item.project) || 'No project'} · {new Date(item.start_at).toLocaleString()}</Typography>{item.description && <Typography variant="body2" color="text.secondary">{item.description}</Typography>}{entryTags(item.id).map((tag) => <Chip key={tag.id} size="small" label={tag.name} sx={{ mr: 0.5, mt: 0.5, bgcolor: tag.color, color: 'white' }} />)}</Box><Typography sx={{ fontVariantNumeric: 'tabular-nums', fontWeight: 600, whiteSpace: 'nowrap' }}>{duration(currentDuration(item, now))}</Typography></Stack><Chip size="small" label={item.status} color={item.status === 'running' ? 'success' : item.status === 'paused' ? 'warning' : 'default'} sx={{ mt: 1 }} /><Stack direction="row" spacing={1} sx={{ mt: 1 }}>{googleLinks[item.id] && <Button size="small" href={googleLinks[item.id]} target="_blank" rel="noopener noreferrer">Calendar event</Button>}<Button size="small" onClick={() => openEdit(item)}>Edit</Button><Button size="small" color="error" onClick={() => { setEntryDialogError(''); setDeletingEntry(item); }}>Delete</Button></Stack></Box>)}</Stack>
          </>}
          {!entriesLoading && !entriesError && entryCount > pageSize && <Box sx={{ p: 2, display: 'flex', justifyContent: 'center' }}><Pagination count={Math.ceil(entryCount / pageSize)} page={page} onChange={(_event, next) => setPage(next)} showFirstButton showLastButton color="primary" aria-label="Time entry pages" /></Box>}
        </Stack></Paper>
      </Stack></Box>}
      {view === 'catalog' && <Box role="tabpanel" id="panel-catalog" aria-labelledby="tab-catalog"><Stack spacing={3}>
        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} sx={{ justifyContent: 'space-between', alignItems: { sm: 'center' } }}><Box><Typography variant="h4" sx={{ fontWeight: 700 }}>Projects, tasks & tags</Typography><Typography color="text.secondary">Arrange work as project → epic → task → subtask, or use any depth. Tags can be used across projects.</Typography></Box><Button variant="outlined" onClick={() => void importCatalog()} disabled={busy || !catalogReady}>Import from existing entries</Button></Stack>
        <Paper variant="outlined" sx={{ p: 2, borderRadius: 3 }}><Stack spacing={2}><Stack direction="row" sx={{ justifyContent: 'space-between', alignItems: 'center' }}><Typography variant="h6">Projects</Typography><Button variant="contained" onClick={() => openCatalog('project')}>New project</Button></Stack>
          {!projects.length && <Typography color="text.secondary">No projects yet.</Typography>}
          {projects.map((item) => <Stack key={item.id} direction={{ xs: 'column', sm: 'row' }} spacing={1} sx={{ alignItems: { sm: 'center' }, justifyContent: 'space-between', borderTop: 1, borderColor: 'divider', pt: 1 }}><Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}><Box sx={{ width: 16, height: 16, borderRadius: 1, bgcolor: item.color }} /><Typography sx={{ fontWeight: 600 }}>{item.name}</Typography><Typography variant="body2" color="text.secondary">{item.key}</Typography>{item.archived && <Chip size="small" label="Archived" />}</Stack><Stack direction="row" spacing={1}><Button size="small" onClick={() => openCatalog('project', 'catalog', item)}>Edit</Button><Button size="small" onClick={() => void changeCatalogState('project', item.id, item.archived)} disabled={busy}>{item.archived ? 'Restore' : 'Archive'}</Button></Stack></Stack>)}
        </Stack></Paper>
        <Paper variant="outlined" sx={{ p: 2, borderRadius: 3 }}><Stack spacing={2}><Stack direction="row" sx={{ justifyContent: 'space-between', alignItems: 'center' }}><Typography variant="h6">Tasks</Typography><Button variant="contained" onClick={() => openCatalog('task')} disabled={!projects.some((item) => !item.archived)}>New task</Button></Stack>
          {!tasks.length && <Typography color="text.secondary">No tasks yet. Create a project first.</Typography>}
          {projects.map((record) => tasks.some((item) => item.project_id === record.id) && <Box key={record.id}><Typography variant="subtitle1" sx={{ fontWeight: 700, mt: 1 }}>{record.name}</Typography>{taskTree(record.id)}</Box>)}
        </Stack></Paper>
        <Paper variant="outlined" sx={{ p: 2, borderRadius: 3 }}><Stack spacing={2}><Stack direction="row" sx={{ justifyContent: 'space-between', alignItems: 'center' }}><Typography variant="h6">Tags</Typography><Button variant="contained" onClick={() => openCatalog('tag')}>New tag</Button></Stack>
          {!tags.length && <Typography color="text.secondary">No tags yet.</Typography>}
          {tags.map((item) => <Stack key={item.id} direction="row" spacing={1} sx={{ alignItems: 'center', justifyContent: 'space-between', borderTop: 1, borderColor: 'divider', pt: 1 }}><Chip label={item.name} sx={{ bgcolor: item.color, color: 'white' }} /><Stack direction="row" spacing={1}><Button size="small" onClick={() => openCatalog('tag', 'catalog', item)}>Edit</Button><Button size="small" color="error" onClick={() => setDeletingTag(item)}>Delete</Button></Stack></Stack>)}
        </Stack></Paper>
      </Stack></Box>}
      {view === 'settings' && <Box role="tabpanel" id="panel-settings" aria-labelledby="tab-settings"><Stack spacing={3}>
        <Box><Typography variant="h4" sx={{ fontWeight: 700 }}>Settings</Typography><Typography color="text.secondary">Manage integration access to your account.</Typography></Box>
      <Paper variant="outlined" sx={{ borderRadius: 3, p: 3 }}><Box component="form" onSubmit={changeAccountPassword}><Stack spacing={2}>
        <Box><Typography variant="h6" sx={{ fontWeight: 700 }}>Change password</Typography><Typography color="text.secondary">Enter your current password and choose a new one.</Typography></Box>
        <TextField label="Current password" type="password" value={currentPassword} onChange={(event) => setCurrentPassword(event.target.value)} required fullWidth autoComplete="current-password" />
        <TextField label="New password" type="password" value={newPassword} onChange={(event) => setNewPassword(event.target.value)} required fullWidth autoComplete="new-password" slotProps={{ htmlInput: { minLength: 8 } }} />
        <TextField label="Confirm new password" type="password" value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} required fullWidth autoComplete="new-password" slotProps={{ htmlInput: { minLength: 8 } }} />
        {changeCodeSent && <TextField label="Email verification code" value={changeNonce} onChange={(event) => setChangeNonce(event.target.value)} required fullWidth autoComplete="one-time-code" />}
        {changeError && <Alert severity="error">{changeError}</Alert>}
        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1}><Button variant="contained" type="submit" disabled={busy || (changeCodeSent && !changeNonce.trim())}>Change password</Button><Button type="button" onClick={() => void sendPasswordChangeCode()} disabled={busy}>Send verification code</Button></Stack>
        <Typography variant="body2" color="text.secondary">Use the email code if Supabase requires reauthentication for this session.</Typography>
      </Stack></Box></Paper>
      <Paper variant="outlined" sx={{ borderRadius: 3, p: 3 }}><Stack spacing={2}>
        <Box><Typography variant="h6" sx={{ fontWeight: 700 }}>Direct Google Calendar</Typography><Typography color="text.secondary">Connect your Google account to create, update, and delete Calendar events when completed time entries change. Timers sync after you stop them.</Typography></Box>
        {googleConnection ? <>
          <Alert severity="success">Connected. New entries use {googleConnection.calendar_name}. Existing Apps Script events continue syncing through Apps Script.</Alert>
          <TextField select label="Calendar for new entries" value={googleConnection.calendar_id} onChange={(event) => void selectGoogleCalendar(event.target.value)} disabled={busy} fullWidth>
            {!googleCalendars.some((calendar) => calendar.id === googleConnection.calendar_id) && <MenuItem value={googleConnection.calendar_id}>{googleConnection.calendar_name}</MenuItem>}
            {googleCalendars.map((calendar) => <MenuItem key={calendar.id} value={calendar.id}>{calendar.summary}{calendar.primary ? ' (primary)' : ''}</MenuItem>)}
          </TextField>
          <Stack direction="row" spacing={1}><Button variant="contained" onClick={() => { setGoogleError(''); setGoogleCalendarDialog(true); }} disabled={busy}>Create calendar</Button><Button variant="outlined" onClick={() => void connectGoogle()} disabled={busy}>Reconnect</Button><Button color="error" onClick={() => void disconnectGoogle()} disabled={busy}>Disconnect</Button></Stack>
          <Typography variant="body2" color="text.secondary">Connected before calendar creation was added? Reconnect once to grant the new Google permission.</Typography>
        </> : <Button variant="contained" onClick={() => void connectGoogle()} disabled={busy}>Connect Google Calendar</Button>}
        {googleError && <Alert severity="error">{googleError}</Alert>}
        {googlePending.length > 0 && <Alert severity="warning" action={<Button color="inherit" size="small" onClick={() => void retryGoogleSync()} disabled={busy || !googleConnection}>Retry</Button>}>
          {googlePending.length} direct Calendar change{googlePending.length === 1 ? '' : 's'} need syncing. {googlePending[0]?.last_error ?? ''}
        </Alert>}
      </Stack></Paper>
      <Paper variant="outlined" sx={{ borderRadius: 3, p: 3 }}><Stack spacing={2}>
        <Box><Typography variant="h6" sx={{ fontWeight: 700 }}>Google Calendar via Apps Script</Typography><Typography color="text.secondary">Deploy the Apps Script in your own Google account, then save its Web app URL here. Existing Apps Script events keep using this connection. If direct Google Calendar is not connected, new entries use Apps Script.</Typography></Box>
        <Accordion variant="outlined"><AccordionSummary><Typography>Apps Script code and setup steps</Typography></AccordionSummary><AccordionDetails><Stack spacing={2}>
          <Typography variant="body2">Create a project at script.google.com or update your existing Clockify script with the code below. In Project Settings → Script properties, set CALENDAR_ID and WEBHOOK_SECRET. Deploy a new Web app version with Execute as Me and access Anyone, authorize Calendar access, then save the /exec URL and the same secret below. Keep both private.</Typography>
          <Button variant="outlined" onClick={() => void navigator.clipboard.writeText(calendarScript)}>Copy script</Button>
          <TextField label="Apps Script code" value={calendarScript} multiline minRows={8} maxRows={18} fullWidth slotProps={{ htmlInput: { readOnly: true } }} />
        </Stack></AccordionDetails></Accordion>
        <Box component="form" onSubmit={saveCalendarSettings}><Stack spacing={2}>
          <TextField label="Apps Script Web app URL" type="url" value={calendarUrl} onChange={(event) => setCalendarUrl(event.target.value)} placeholder="https://script.google.com/macros/s/.../exec" helperText="Use the deployed /exec URL, not the /dev test URL." required fullWidth slotProps={{ htmlInput: { maxLength: 2048 } }} />
          <TextField label="WEBHOOK_SECRET" type="password" value={calendarSecret} onChange={(event) => setCalendarSecret(event.target.value)} helperText={calendarHasSecret ? 'A secret is saved. Leave blank to keep it, or enter a replacement.' : 'Enter the exact WEBHOOK_SECRET in your Apps Script properties.'} required={!calendarHasSecret} fullWidth autoComplete="off" slotProps={{ htmlInput: { maxLength: 512 } }} />
          <Stack direction="row" spacing={1}><Button type="submit" variant="contained" disabled={busy || !calendarUrl.trim() || (!calendarHasSecret && !calendarSecret.trim()) || (calendarUrl === savedCalendarUrl && !calendarSecret)}>Save connection</Button>{savedCalendarUrl && <Button color="error" onClick={() => void disconnectCalendar()} disabled={busy}>Disconnect</Button>}</Stack>
        </Stack></Box>
        {calendarError && <Alert severity="error">{calendarError}</Alert>}
        {savedCalendarUrl && <Alert severity="success">Calendar connection configured for this account.</Alert>}
        {calendarPending.length > 0 && <Alert severity="warning" action={<Button color="inherit" size="small" onClick={() => void retryCalendarSync()} disabled={busy || !savedCalendarUrl}>Retry</Button>}>
          {calendarPending.length} Calendar change{calendarPending.length === 1 ? '' : 's'} need syncing. {calendarPending[0]?.last_error ?? ''}
        </Alert>}
      </Stack></Paper>
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
      {catalogReady ? <><TextField select label="Project" value={manualProject} onChange={(e) => { setManualProject(e.target.value); setManualTask(''); }} fullWidth><MenuItem value="">No project</MenuItem>{projects.filter((item) => !item.archived).map((item) => <MenuItem key={item.id} value={item.key}>{item.name} ({item.key})</MenuItem>)}{manualProject && !projects.some((item) => item.key === manualProject) && <MenuItem value={manualProject}>{manualProject} (legacy)</MenuItem>}</TextField><Button onClick={() => openCatalog('project', 'manual')}>New project</Button><TextField select label="Task" value={manualTask} onChange={(e) => setManualTask(e.target.value)} fullWidth><MenuItem value="">No task</MenuItem>{tasks.filter((item) => !item.archived && item.project_id === projects.find((record) => record.key === manualProject)?.id).map((item) => <MenuItem key={item.id} value={item.key}>{taskPath(item)} ({item.key})</MenuItem>)}{manualTask && !tasks.some((item) => item.key === manualTask && item.project_id === projects.find((record) => record.key === manualProject)?.id) && <MenuItem value={manualTask}>{manualTask} (legacy)</MenuItem>}</TextField><Button onClick={() => openCatalog('task', 'manual')} disabled={!projects.some((item) => item.key === manualProject)}>New task</Button></> : <><TextField label="Project" value={manualProject} onChange={(e) => setManualProject(e.target.value)} fullWidth slotProps={{ htmlInput: { maxLength: 500 } }} /><TextField label="Task" value={manualTask} onChange={(e) => setManualTask(e.target.value)} fullWidth slotProps={{ htmlInput: { maxLength: 500 } }} /></>}
      <TextField label="Description" value={manualDescription} onChange={(e) => setManualDescription(e.target.value)} fullWidth multiline minRows={2} slotProps={{ htmlInput: { maxLength: 500 } }} />
      {catalogReady && <Stack direction="row" spacing={1}><Autocomplete multiple options={tags} getOptionLabel={(option) => option.name} value={tags.filter((item) => manualTagIds.includes(item.id))} onChange={(_event, value) => setManualTagIds(value.map((item) => item.id))} renderInput={(params) => <TextField {...params} label="Tags" />} sx={{ flex: 1 }} /><Button onClick={() => openCatalog('tag', 'manual')}>New tag</Button></Stack>}
      <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}><DatePicker label="Start date" value={manualStartDate} onChange={setManualStartDate} slotProps={{ textField: { required: true, fullWidth: true } }} /><TimePicker label="Start time" value={manualStartTime} onChange={setManualStartTime} ampm={false} slotProps={{ textField: { required: true, fullWidth: true } }} /></Stack>
      <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}><DatePicker label="End date" value={manualEndDate} onChange={setManualEndDate} slotProps={{ textField: { required: true, fullWidth: true } }} /><TimePicker label="End time" value={manualEndTime} onChange={setManualEndTime} ampm={false} slotProps={{ textField: { required: true, fullWidth: true } }} /></Stack>
      {error && <Alert severity="error">{error}</Alert>}
    </Stack></DialogContent><DialogActions><Button onClick={() => setManualDialogOpen(false)}>Cancel</Button><Button type="submit" variant="contained" disabled={busy}>Add entry</Button></DialogActions></Box></Dialog>
    <Dialog open={!!selectedTimelineEntry} onClose={() => setSelectedTimelineEntry(null)} fullWidth maxWidth="xs"><DialogTitle>Time entry</DialogTitle><DialogContent><Stack spacing={1}>
      <Typography variant="h6">{selectedTimelineEntry ? taskLabel(selectedTimelineEntry.project, selectedTimelineEntry.task) || selectedTimelineEntry.description || 'Untitled work' : ''}</Typography>
      <Typography>Project: {selectedTimelineEntry ? projectLabel(selectedTimelineEntry.project) || 'No project' : ''}</Typography>
      {selectedTimelineEntry?.description && <Typography color="text.secondary">{selectedTimelineEntry.description}</Typography>}
      {selectedTimelineEntry && <Stack direction="row" spacing={0.5}>{entryTags(selectedTimelineEntry.id).map((tag) => <Chip key={tag.id} size="small" label={tag.name} sx={{ bgcolor: tag.color, color: 'white' }} />)}</Stack>}
      {selectedTimelineEntry && <><Typography>Started: {new Date(selectedTimelineEntry.start_at).toLocaleString()}</Typography><Typography>{selectedTimelineEntry.end_at ? `Ended: ${new Date(selectedTimelineEntry.end_at).toLocaleString()}` : `Status: ${selectedTimelineEntry.status}`}</Typography><Typography sx={{ fontVariantNumeric: 'tabular-nums' }}>Tracked: {duration(currentDuration(selectedTimelineEntry, now))}</Typography></>}
    </Stack></DialogContent><DialogActions>{selectedTimelineEntry && <>{googleLinks[selectedTimelineEntry.id] && <Button href={googleLinks[selectedTimelineEntry.id]} target="_blank" rel="noopener noreferrer">Calendar event</Button>}<Button onClick={() => openEdit(selectedTimelineEntry)}>Edit</Button><Button color="error" onClick={() => { setEntryDialogError(''); setDeletingEntry(selectedTimelineEntry); setSelectedTimelineEntry(null); }}>Delete</Button></>}<Button onClick={() => setSelectedTimelineEntry(null)}>Close</Button></DialogActions></Dialog>
    <Dialog open={googleCalendarDialog} onClose={() => { if (!busy) setGoogleCalendarDialog(false); }} fullWidth maxWidth="xs"><Box component="form" onSubmit={createCalendar}><DialogTitle>Create Google Calendar</DialogTitle><DialogContent><Stack spacing={2} sx={{ pt: 1 }}><Typography variant="body2" color="text.secondary">The new calendar will belong to your connected Google account and will be selected for future entries.</Typography><TextField label="Calendar name" value={googleCalendarName} onChange={(event) => setGoogleCalendarName(event.target.value)} required autoFocus fullWidth slotProps={{ htmlInput: { maxLength: 255 } }} />{googleError && <Alert severity="error">{googleError}</Alert>}</Stack></DialogContent><DialogActions><Button onClick={() => setGoogleCalendarDialog(false)} disabled={busy}>Cancel</Button><Button type="submit" variant="contained" disabled={busy || !googleCalendarName.trim()}>Create</Button></DialogActions></Box></Dialog>
    <Dialog open={!!editingEntry} onClose={() => { if (!busy) setEditingEntry(null); }} fullWidth maxWidth="sm"><Box component="form" onSubmit={updateEntry}><DialogTitle>Edit time entry</DialogTitle><DialogContent><Stack spacing={2} sx={{ pt: 1 }}>
      {catalogReady ? <><TextField select label="Project" value={editProject} onChange={(e) => { setEditProject(e.target.value); setEditTask(''); }} fullWidth><MenuItem value="">No project</MenuItem>{projects.filter((item) => !item.archived || item.key === editProject).map((item) => <MenuItem key={item.id} value={item.key}>{item.name} ({item.key})</MenuItem>)}{editProject && !projects.some((item) => item.key === editProject) && <MenuItem value={editProject}>{editProject} (legacy)</MenuItem>}</TextField><Button onClick={() => openCatalog('project', 'edit')}>New project</Button><TextField select label="Task" value={editTask} onChange={(e) => setEditTask(e.target.value)} fullWidth><MenuItem value="">No task</MenuItem>{tasks.filter((item) => (!item.archived || item.key === editTask) && item.project_id === projects.find((record) => record.key === editProject)?.id).map((item) => <MenuItem key={item.id} value={item.key}>{taskPath(item)} ({item.key})</MenuItem>)}{editTask && !tasks.some((item) => item.key === editTask && item.project_id === projects.find((record) => record.key === editProject)?.id) && <MenuItem value={editTask}>{editTask} (legacy)</MenuItem>}</TextField><Button onClick={() => openCatalog('task', 'edit')} disabled={!projects.some((item) => item.key === editProject)}>New task</Button></> : <><TextField label="Project" value={editProject} onChange={(e) => setEditProject(e.target.value)} fullWidth slotProps={{ htmlInput: { maxLength: 500 } }} /><TextField label="Task" value={editTask} onChange={(e) => setEditTask(e.target.value)} fullWidth slotProps={{ htmlInput: { maxLength: 500 } }} /></>}
      <TextField label="Description" value={editDescription} onChange={(e) => setEditDescription(e.target.value)} fullWidth multiline minRows={2} slotProps={{ htmlInput: { maxLength: 500 } }} />
      {catalogReady && <Stack direction="row" spacing={1}><Autocomplete multiple options={tags} getOptionLabel={(option) => option.name} value={tags.filter((item) => editTagIds.includes(item.id))} onChange={(_event, value) => setEditTagIds(value.map((item) => item.id))} renderInput={(params) => <TextField {...params} label="Tags" />} sx={{ flex: 1 }} /><Button onClick={() => openCatalog('tag', 'edit')}>New tag</Button></Stack>}
      {editingEntry?.status === 'stopped' ? <><Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}><DatePicker label="Start date" value={editStartDate} onChange={setEditStartDate} slotProps={{ textField: { required: true, fullWidth: true } }} /><TimePicker label="Start time" value={editStartTime} onChange={setEditStartTime} ampm={false} slotProps={{ textField: { required: true, fullWidth: true } }} /></Stack><Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}><DatePicker label="End date" value={editEndDate} onChange={setEditEndDate} slotProps={{ textField: { required: true, fullWidth: true } }} /><TimePicker label="End time" value={editEndTime} onChange={setEditEndTime} ampm={false} slotProps={{ textField: { required: true, fullWidth: true } }} /></Stack><Typography variant="body2" color="text.secondary">Changing start or end time recalculates tracked duration from the new time range.</Typography></> : <Typography variant="body2" color="text.secondary">Stop this timer to edit its start and end times.</Typography>}
      {entryDialogError && <Alert severity="error">{entryDialogError}</Alert>}
    </Stack></DialogContent><DialogActions><Button onClick={() => setEditingEntry(null)} disabled={busy}>Cancel</Button><Button type="submit" variant="contained" disabled={busy}>Save changes</Button></DialogActions></Box></Dialog>
    <Dialog open={!!deletingEntry} onClose={() => { if (!busy) setDeletingEntry(null); }} fullWidth maxWidth="xs"><DialogTitle>Delete time entry?</DialogTitle><DialogContent><Typography>Delete “{deletingEntry?.task || deletingEntry?.description || 'Untitled work'}”? {deletingEntry?.status === 'stopped' ? 'This cannot be undone.' : 'This will remove the active timer and cannot be undone.'}</Typography>{entryDialogError && <Alert severity="error" sx={{ mt: 2 }}>{entryDialogError}</Alert>}</DialogContent><DialogActions><Button onClick={() => setDeletingEntry(null)} disabled={busy}>Cancel</Button><Button variant="contained" color="error" onClick={() => void deleteEntry()} disabled={busy}>Delete entry</Button></DialogActions></Dialog>
    <Dialog open={!!catalogDialog} onClose={() => { if (!busy) setCatalogDialog(null); }} fullWidth maxWidth="xs"><Box component="form" onSubmit={saveCatalog}><DialogTitle>{catalogDialog?.item ? 'Edit' : 'New'} {catalogDialog?.kind}</DialogTitle><DialogContent><Stack spacing={2} sx={{ pt: 1 }}>
      <TextField label="Name" value={catalogName} onChange={(event) => setCatalogName(event.target.value)} required fullWidth slotProps={{ htmlInput: { maxLength: catalogDialog?.kind === 'tag' ? 100 : 200 } }} />
      {catalogDialog?.kind !== 'tag' && <TextField label="Key" value={catalogKey} onChange={(event) => setCatalogKey(event.target.value)} disabled={!!catalogDialog?.item} helperText={catalogDialog?.item ? 'Keys stay fixed so past entries and Jira links remain stable.' : 'Optional; generated from the name if blank. Use a Jira project or issue key when relevant.'} fullWidth slotProps={{ htmlInput: { maxLength: 100 } }} />}
      {catalogDialog?.kind === 'task' && <TextField select label="Project" value={catalogProjectId} onChange={(event) => { setCatalogProjectId(event.target.value); setCatalogParentTaskId(''); }} disabled={!!catalogDialog?.item} required fullWidth>{projects.filter((item) => !item.archived || item.id === catalogProjectId).map((item) => <MenuItem key={item.id} value={item.id}>{item.name} ({item.key})</MenuItem>)}</TextField>}
      {catalogDialog?.kind === 'task' && <><TextField select label="Issue type" value={catalogIssueType} onChange={(event) => setCatalogIssueType(event.target.value)} fullWidth><MenuItem value="Epic">Epic</MenuItem><MenuItem value="Task">Task</MenuItem><MenuItem value="Subtask">Subtask</MenuItem>{!['Epic', 'Task', 'Subtask'].includes(catalogIssueType) && <MenuItem value={catalogIssueType}>{catalogIssueType}</MenuItem>}</TextField><TextField select label="Parent task" value={catalogParentTaskId} onChange={(event) => setCatalogParentTaskId(event.target.value)} fullWidth helperText="Optional. Parent and child must belong to the same project."><MenuItem value="">No parent</MenuItem>{tasks.filter((record) => !record.archived && record.project_id === catalogProjectId && !(catalogDialog.item && taskDescendants(catalogDialog.item.id).has(record.id))).map((record) => <MenuItem key={record.id} value={record.id}>{taskPath(record)} ({record.key})</MenuItem>)}</TextField></>}
      {catalogDialog?.kind !== 'task' && <TextField label="Color" type="color" value={catalogColor} onChange={(event) => setCatalogColor(event.target.value)} fullWidth slotProps={{ inputLabel: { shrink: true } }} />}
      {catalogDialogError && <Alert severity="error">{catalogDialogError}</Alert>}
    </Stack></DialogContent><DialogActions><Button onClick={() => setCatalogDialog(null)} disabled={busy}>Cancel</Button><Button type="submit" variant="contained" disabled={busy}>Save</Button></DialogActions></Box></Dialog>
    <Dialog open={!!deletingTag} onClose={() => setDeletingTag(null)} fullWidth maxWidth="xs"><DialogTitle>Delete tag?</DialogTitle><DialogContent><Typography>Delete “{deletingTag?.name}” from your tag list and all entries? This cannot be undone.</Typography>{error && <Alert severity="error" sx={{ mt: 2 }}>{error}</Alert>}</DialogContent><DialogActions><Button onClick={() => setDeletingTag(null)}>Cancel</Button><Button color="error" variant="contained" disabled={busy} onClick={() => { if (deletingTag) void changeCatalogState('tag', deletingTag.id, false).then((saved) => { if (saved) setDeletingTag(null); }); }}>Delete tag</Button></DialogActions></Dialog>
  </Box></LocalizationProvider>;
}
