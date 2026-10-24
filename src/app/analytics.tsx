'use client';

import { useEffect, useMemo, useState } from 'react';
import { Alert, Box, Button, Card, CardContent, Chip, CircularProgress, Divider, FormControlLabel, Grid, MenuItem, Pagination, Paper, Stack, Switch, Table, TableBody, TableCell, TableContainer, TableHead, TableRow, TextField, ToggleButton, ToggleButtonGroup, Typography } from '@mui/material';
import { DatePicker } from '@mui/x-date-pickers/DatePicker';
import { BarChart } from '@mui/x-charts/BarChart';
import { LineChart } from '@mui/x-charts/LineChart';
import { PieChart } from '@mui/x-charts/PieChart';
import dayjs, { type Dayjs } from 'dayjs';
import { taskLineage } from '@/lib/entry-insights';
import type { AnalyticsEntry, AnalyticsGroup, AnalyticsGroupBy } from '@/lib/analytics';

type Project = { id: string; key: string; name: string };
type Task = { id: string; project_id: string; key: string; name: string; parent_task_id: string | null };
type Tag = { id: string; name: string };
type Report = {
  total_seconds: number; entry_count: number; active_count: number;
  groups: AnalyticsGroup[]; group_count: number; groups_truncated: boolean;
  trend: { day: string; seconds: number; entries: number }[]; overlapping_groups: boolean;
};
type Query = { from: string; to: string; fromLabel: string; toLabel: string; project: string; taskId: string; includeChildren: boolean; tagId: string; status: string; search: string; groupBy: AnalyticsGroupBy; timeZone: string; refresh: number };

function duration(seconds: number) {
  const whole = Math.floor(Math.max(0, seconds));
  return `${Math.floor(whole / 3600)}:${String(Math.floor(whole % 3600 / 60)).padStart(2, '0')}:${String(whole % 60).padStart(2, '0')}`;
}

function queryFor(from: Dayjs, to: Dayjs, filters: Omit<Query, 'from' | 'to' | 'fromLabel' | 'toLabel' | 'refresh'>, refresh: number): Query {
  return { ...filters, from: from.startOf('day').toDate().toISOString(), to: to.add(1, 'day').startOf('day').toDate().toISOString(),
    fromLabel: from.format('YYYY-MM-DD'), toLabel: to.format('YYYY-MM-DD'), refresh };
}

export default function Analytics({ request, projects, tasks, tags, onOpenEntry }: {
  request: (path: string, init?: RequestInit) => Promise<Report>;
  projects: Project[]; tasks: Task[]; tags: Tag[]; onOpenEntry: (id: string) => void;
}) {
  const [preset, setPreset] = useState('this_month');
  const [fromDate, setFromDate] = useState<Dayjs | null>(() => dayjs().startOf('month'));
  const [toDate, setToDate] = useState<Dayjs | null>(() => dayjs());
  const [project, setProject] = useState('');
  const [taskId, setTaskId] = useState('');
  const [includeChildren, setIncludeChildren] = useState(true);
  const [tagId, setTagId] = useState('');
  const [status, setStatus] = useState('all');
  const [search, setSearch] = useState('');
  const [groupBy, setGroupBy] = useState<AnalyticsGroupBy>('project');
  const [chartType, setChartType] = useState<'bar' | 'donut' | 'trend'>('bar');
  const [query, setQuery] = useState<Query>(() => queryFor(dayjs().startOf('month'), dayjs(), {
    project: '', taskId: '', includeChildren: true, tagId: '', status: 'all', search: '', groupBy: 'project',
    timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC',
  }, 0));
  const [report, setReport] = useState<Report | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [focusedGroupKey, setFocusedGroupKey] = useState('');
  const [groupPage, setGroupPage] = useState(1);

  useEffect(() => {
    let active = true;
    const params = new URLSearchParams({ from: query.from, to: query.to, timezone: query.timeZone, group_by: query.groupBy,
      status: query.status, include_children: String(query.includeChildren) });
    if (query.project) params.set('project', query.project);
    if (query.taskId) params.set('task_id', query.taskId);
    if (query.tagId) params.set('tag_id', query.tagId);
    if (query.search) params.set('q', query.search);
    setLoading(true); setError(''); setReport(null);
    request(`/api/analytics?${params}`).then((data) => { if (active) { setReport(data); setFocusedGroupKey(''); setGroupPage(1); } })
      .catch((caught) => { if (active) setError(caught instanceof Error ? caught.message : 'Could not load analytics'); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [request, query]);

  function choosePreset(value: string) {
    setPreset(value);
    if (value === 'today') { setFromDate(dayjs().startOf('day')); setToDate(dayjs()); }
    if (value === 'this_week') { const today = dayjs(); setFromDate(today.subtract((today.day() + 6) % 7, 'day').startOf('day')); setToDate(today); }
    if (value === 'this_month') { setFromDate(dayjs().startOf('month')); setToDate(dayjs()); }
    if (value === 'last_30') { setFromDate(dayjs().subtract(29, 'day').startOf('day')); setToDate(dayjs()); }
  }

  function applyFilters() {
    if (!fromDate?.isValid() || !toDate?.isValid() || toDate.isBefore(fromDate, 'day') || toDate.diff(fromDate, 'day') > 365) {
      setError('Choose a valid date range of up to 366 days'); return;
    }
    setQuery(queryFor(fromDate, toDate, { project, taskId, includeChildren, tagId, status, search: search.trim(), groupBy,
      timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC' }, query.refresh + 1));
  }

  const visibleTasks = useMemo(() => tasks.filter((task) => !project || projects.find((item) => item.id === task.project_id)?.key === project), [tasks, projects, project]);
  const focusedGroup = report?.groups.find((group) => group.key === focusedGroupKey);
  const chartGroups = report?.groups.slice(0, 10) ?? [];
  const chartLabels = new Map(chartGroups.map((group) => [group.key, group.label]));
  const pieGroups = report?.groups.slice(0, 7) ?? [];
  const remainingSeconds = report?.groups.slice(7).reduce((sum, group) => sum + group.seconds, 0) ?? 0;
  const daily = useMemo(() => {
    if (!report) return [];
    const byDay = new Map(report.trend.map((item) => [item.day, item]));
    const values = [];
    for (let day = dayjs(query.fromLabel); !day.isAfter(dayjs(query.toLabel), 'day'); day = day.add(1, 'day')) {
      const label = day.format('YYYY-MM-DD');
      values.push(byDay.get(label) ?? { day: label, seconds: 0, entries: 0 });
    }
    return values;
  }, [report, query]);
  const averageSeconds = report && daily.length ? report.total_seconds / daily.length : 0;
  const peakDay = report?.trend.reduce<{ day: string; seconds: number } | null>((best, item) => !best || item.seconds > best.seconds ? item : best, null);

  return <Stack spacing={3}>
    <Box><Typography variant="h4" sx={{ fontWeight: 700 }}>Analytics</Typography><Typography color="text.secondary">See where your time goes across projects, nested tasks, tags, and dates.</Typography></Box>
    <Paper variant="outlined" sx={{ p: 2, borderRadius: 3 }}><Stack spacing={2}>
      <Typography variant="h6">Filters</Typography>
      <Grid container spacing={2}>
        <Grid size={{ xs: 12, sm: 4, md: 2 }}><TextField select fullWidth label="Period" value={preset} onChange={(event) => choosePreset(event.target.value)}><MenuItem value="today">Today</MenuItem><MenuItem value="this_week">This week</MenuItem><MenuItem value="this_month">This month</MenuItem><MenuItem value="last_30">Last 30 days</MenuItem><MenuItem value="custom">Custom</MenuItem></TextField></Grid>
        <Grid size={{ xs: 12, sm: 4, md: 2 }}><DatePicker label="From" value={fromDate} onChange={(value) => { setFromDate(value); setPreset('custom'); }} slotProps={{ textField: { fullWidth: true } }} /></Grid>
        <Grid size={{ xs: 12, sm: 4, md: 2 }}><DatePicker label="To" value={toDate} onChange={(value) => { setToDate(value); setPreset('custom'); }} slotProps={{ textField: { fullWidth: true } }} /></Grid>
        <Grid size={{ xs: 12, sm: 6, md: 3 }}><TextField select fullWidth label="Project" value={project} onChange={(event) => { setProject(event.target.value); setTaskId(''); }}><MenuItem value="">All projects</MenuItem>{projects.map((item) => <MenuItem key={item.id} value={item.key}>{item.name}</MenuItem>)}</TextField></Grid>
        <Grid size={{ xs: 12, sm: 6, md: 3 }}><TextField select fullWidth label="Task" value={taskId} onChange={(event) => setTaskId(event.target.value)}><MenuItem value="">All tasks</MenuItem>{visibleTasks.map((item) => <MenuItem key={item.id} value={item.id}>{projects.find((project) => project.id === item.project_id)?.name} › {taskLineage(item, tasks).map((node) => node.name).join(' › ')}</MenuItem>)}</TextField></Grid>
        <Grid size={{ xs: 12, sm: 6, md: 3 }}><TextField select fullWidth label="Tag" value={tagId} onChange={(event) => setTagId(event.target.value)}><MenuItem value="">All tags</MenuItem>{tags.map((item) => <MenuItem key={item.id} value={item.id}>{item.name}</MenuItem>)}</TextField></Grid>
        <Grid size={{ xs: 12, sm: 6, md: 3 }}><TextField select fullWidth label="Timer status" value={status} onChange={(event) => setStatus(event.target.value)}><MenuItem value="all">All</MenuItem><MenuItem value="stopped">Completed</MenuItem><MenuItem value="running">Running</MenuItem><MenuItem value="paused">Paused</MenuItem></TextField></Grid>
        <Grid size={{ xs: 12, sm: 6, md: 3 }}><TextField select fullWidth label="Group by" value={groupBy} onChange={(event) => setGroupBy(event.target.value as AnalyticsGroupBy)}><MenuItem value="project">Project</MenuItem><MenuItem value="task">Task path</MenuItem><MenuItem value="root_task">Top-level task</MenuItem><MenuItem value="tag">Tag</MenuItem><MenuItem value="day">Day</MenuItem><MenuItem value="week">Week</MenuItem></TextField></Grid>
        <Grid size={{ xs: 12, sm: 6, md: 5 }}><TextField fullWidth label="Search entry text or keys" value={search} onChange={(event) => setSearch(event.target.value)} slotProps={{ htmlInput: { maxLength: 100 } }} /></Grid>
        <Grid size={{ xs: 12, sm: 6, md: 4 }}><FormControlLabel control={<Switch checked={includeChildren} onChange={(event) => setIncludeChildren(event.target.checked)} disabled={!taskId} />} label="Include nested tasks" /></Grid>
      </Grid>
      <Stack direction="row" spacing={1}><Button variant="contained" onClick={applyFilters} disabled={loading}>Apply filters</Button><Button onClick={() => setQuery((previous) => ({ ...previous, refresh: previous.refresh + 1 }))} disabled={loading}>Refresh</Button></Stack>
      <Typography variant="caption" color="text.secondary">Entries are included by their start date in your time zone. Running time is calculated when the report loads.</Typography>
    </Stack></Paper>

    {error && <Alert severity="error">{error}</Alert>}
    {loading && <Box sx={{ display: 'grid', placeItems: 'center', py: 6 }}><CircularProgress aria-label="Loading analytics" /></Box>}
    {!loading && report && <>
      <Grid container spacing={2}>
        {[
          ['Tracked time', duration(report.total_seconds)], ['Time entries', String(report.entry_count)],
          ['Average per day', duration(averageSeconds)], ['Busiest day', peakDay && peakDay.seconds > 0 ? `${peakDay.day} · ${duration(peakDay.seconds)}` : '—'],
        ].map(([label, value]) => <Grid key={label} size={{ xs: 12, sm: 6, md: 3 }}><Card variant="outlined" sx={{ height: '100%' }}><CardContent><Typography variant="body2" color="text.secondary">{label}</Typography><Typography variant="h6" sx={{ fontWeight: 700 }}>{value}</Typography></CardContent></Card></Grid>)}
      </Grid>
      {report.active_count > 0 && <Alert severity="info">{report.active_count} active {report.active_count === 1 ? 'timer is' : 'timers are'} included. Refresh for current running time.</Alert>}
      {report.overlapping_groups && <Alert severity="info">Entries with multiple tags appear in each matching tag group. The tracked-time total counts every entry once.</Alert>}
      {report.groups_truncated && <Alert severity="warning">Showing the largest 500 of {report.group_count} groups. Narrow the filters to see smaller groups.</Alert>}
      {report.entry_count === 0 ? <Paper variant="outlined" sx={{ p: 4, textAlign: 'center' }}><Typography variant="h6">No time entries match these filters</Typography><Typography color="text.secondary">Try a wider date range or clear a category filter.</Typography></Paper> : <>
        <Paper variant="outlined" sx={{ p: 2, borderRadius: 3 }}><Stack spacing={1}>
          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} sx={{ justifyContent: 'space-between', alignItems: { sm: 'center' } }}><Box><Typography variant="h6">Time breakdown</Typography><Typography variant="body2" color="text.secondary">{chartType === 'trend' ? 'Daily tracked time' : `Top groups by ${query.groupBy.replaceAll('_', ' ')}`}</Typography></Box><ToggleButtonGroup size="small" exclusive value={chartType} onChange={(_event, value) => { if (value) setChartType(value); }} aria-label="Chart type"><ToggleButton value="bar">Bar</ToggleButton><ToggleButton value="donut">Donut</ToggleButton><ToggleButton value="trend">Trend</ToggleButton></ToggleButtonGroup></Stack>
          {report.total_seconds === 0 ? <Typography color="text.secondary" sx={{ py: 5, textAlign: 'center' }}>These entries have no tracked duration yet.</Typography> : <Box sx={{ width: '100%', minWidth: 0, overflowX: 'auto' }}>
            {chartType === 'bar' && <BarChart height={340} xAxis={[{ scaleType: 'band', data: chartGroups.map((group) => group.key), valueFormatter: (value: string) => { const label = chartLabels.get(value) ?? value; return label.length > 15 ? `${label.slice(0, 15)}…` : label; } }]} yAxis={[{ label: 'Hours' }]} series={[{ label: 'Tracked hours', data: chartGroups.map((group) => group.seconds / 3600) }]} />}
            {chartType === 'donut' && <PieChart height={340} series={[{ innerRadius: 75, data: [...pieGroups.map((group) => ({ id: group.key, label: group.label, value: group.seconds / 3600 })), ...(remainingSeconds > 0 ? [{ id: 'other', label: 'Other groups', value: remainingSeconds / 3600 }] : [])] }]} />}
            {chartType === 'trend' && <LineChart height={340} xAxis={[{ scaleType: 'time', data: daily.map((item) => new Date(`${item.day}T12:00:00Z`)), valueFormatter: (value: Date) => dayjs(value).format('MMM D') }]} yAxis={[{ label: 'Hours' }]} series={[{ label: 'Tracked hours', data: daily.map((item) => item.seconds / 3600) }]} />}
          </Box>}
          {report.groups.length > 10 && chartType === 'bar' && <Typography variant="caption" color="text.secondary">The bar chart shows the ten largest groups; the table below includes the full breakdown.</Typography>}
        </Stack></Paper>
        <Paper variant="outlined" sx={{ borderRadius: 3, overflow: 'hidden' }}><Box sx={{ p: 2 }}><Typography variant="h6">Breakdown</Typography><Typography variant="body2" color="text.secondary">Select a group to inspect recent entries.</Typography></Box><Divider />
          <TableContainer><Table size="small" aria-label="Analytics breakdown"><TableHead><TableRow><TableCell>Group</TableCell><TableCell align="right">Entries</TableCell><TableCell align="right">Time</TableCell><TableCell align="right">Share</TableCell></TableRow></TableHead><TableBody>{report.groups.slice((groupPage - 1) * 15, groupPage * 15).map((group) => <TableRow key={group.key} hover selected={focusedGroupKey === group.key}><TableCell><Button size="small" onClick={() => setFocusedGroupKey(group.key)} sx={{ textAlign: 'left', justifyContent: 'flex-start', textTransform: 'none' }}>{group.label}</Button></TableCell><TableCell align="right">{group.entries}</TableCell><TableCell align="right">{duration(group.seconds)}</TableCell><TableCell align="right">{report.total_seconds ? `${Math.round(group.seconds / report.total_seconds * 100)}%` : '0%'}</TableCell></TableRow>)}</TableBody></Table></TableContainer>
          {report.groups.length > 15 && <Box sx={{ p: 2, display: 'flex', justifyContent: 'center' }}><Pagination count={Math.ceil(report.groups.length / 15)} page={groupPage} onChange={(_event, value) => setGroupPage(value)} /> </Box>}
        </Paper>
        {focusedGroup && <Paper variant="outlined" sx={{ p: 2, borderRadius: 3 }}><Stack spacing={1}><Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}><Typography variant="h6">{focusedGroup.label}</Typography><Chip size="small" label={duration(focusedGroup.seconds)} /></Stack><Typography variant="body2" color="text.secondary">Five most recent entries in this group</Typography>{focusedGroup.recent_entries.map((entry: AnalyticsEntry) => <Box key={entry.id}><Divider sx={{ mb: 1 }} /><Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} sx={{ justifyContent: 'space-between', alignItems: { sm: 'center' } }}><Box><Typography variant="body2" sx={{ fontWeight: 600 }}>{entry.description || entry.task || 'Untitled work'}</Typography><Typography variant="caption" color="text.secondary">{entry.project || 'No project'} · {new Date(entry.start_at).toLocaleString()}</Typography></Box><Button size="small" onClick={() => onOpenEntry(entry.id)}>Entry details</Button></Stack></Box>)}</Stack></Paper>}
      </>}
    </>}
  </Stack>;
}
