import { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { invoke, view } from '@forge/bridge';
import {
  Alert, Box, Button, Card, CardContent, CircularProgress, Divider,
  Stack, TextField, Typography,
} from '@mui/material';

type Entry = {
  id: string;
  project: string;
  task: string;
  description: string;
  status: 'running' | 'paused' | 'stopped';
  start_at: string;
  last_resumed_at: string | null;
  elapsed_seconds: number;
};

async function call<T extends object>(key: string, payload?: Record<string, unknown>): Promise<T> {
  const result = await invoke<T>(key, payload);
  return 'body' in result ? result.body : result;
}

function duration(seconds: number) {
  const value = Math.max(0, Math.floor(seconds));
  return [Math.floor(value / 3600), Math.floor((value % 3600) / 60), value % 60]
    .map((part) => String(part).padStart(2, '0')).join(':');
}

function elapsed(entry: Entry, now: number) {
  return Number(entry.elapsed_seconds) + (entry.status === 'running' && entry.last_resumed_at
    ? Math.max(0, (now - Date.parse(entry.last_resumed_at)) / 1000) : 0);
}

function App() {
  const [issueKey, setIssueKey] = useState('');
  const [connected, setConnected] = useState<boolean | null>(null);
  const [token, setToken] = useState('');
  const [entry, setEntry] = useState<Entry | null>(null);
  const [entries, setEntries] = useState<Entry[]>([]);
  const [description, setDescription] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [now, setNow] = useState(Date.now());

  async function refresh() {
    const [timer, history] = await Promise.all([
      call<{ entry: Entry | null }>('timer'),
      call<{ entries: Entry[] }>('entries'),
    ]);
    setEntry(timer.entry);
    setEntries(history.entries);
  }

  useEffect(() => {
    const clock = window.setInterval(() => setNow(Date.now()), 1000);
    const poll = window.setInterval(() => {
      if (connected) refresh().catch(() => undefined);
    }, 30000);
    return () => { window.clearInterval(clock); window.clearInterval(poll); };
  }, [connected]);

  useEffect(() => {
    view.getContext().then((context) => {
      const extension = context.extension as { issue?: { key?: string }; issueKey?: string } | undefined;
      setIssueKey(extension?.issue?.key ?? extension?.issueKey ?? '');
    }).catch(() => setError('Could not read the Jira issue'));
    call<{ connected: boolean }>('connection').then(async (result) => {
      setConnected(result.connected);
      if (result.connected) await refresh();
    }).catch((cause) => { setConnected(false); setError(message(cause)); });
  }, []);

  async function run(operation: () => Promise<void>) {
    setBusy(true);
    setError('');
    try { await operation(); } catch (cause) { setError(message(cause)); }
    finally { setBusy(false); }
  }

  const project = issueKey.split('-')[0] ?? '';
  const issueEntries = entries.filter((item) => item.task === issueKey).slice(0, 5);

  return <Box sx={{ p: 2, maxWidth: 600 }}>
    <Stack spacing={2}>
      <Typography variant="h6">Timelogger {issueKey && `· ${issueKey}`}</Typography>
      {error && <Alert severity="error" onClose={() => setError('')}>{error}</Alert>}
      {connected === null && <CircularProgress size={24} />}
      {connected === false && <Card variant="outlined"><CardContent><Stack spacing={2}>
        <Typography variant="subtitle1">Connect your Timelogger account</Typography>
        <Typography variant="body2">Create an API token in Timelogger Settings, then paste it here. It is stored in Forge secret storage for your Jira account.</Typography>
        <TextField label="Timelogger API token" type="password" value={token} onChange={(event) => setToken(event.target.value)} fullWidth autoComplete="off" />
        <Button variant="contained" disabled={busy || !token.trim()} onClick={() => run(async () => {
          await invoke('connect', { token });
          setToken('');
          setConnected(true);
          await refresh();
        })}>Connect</Button>
      </Stack></CardContent></Card>}
      {connected === true && <>
        <Card variant="outlined"><CardContent><Stack spacing={2}>
          <Typography variant="subtitle1">Current timer</Typography>
          {entry ? <>
            <Typography variant="h4" component="div">{duration(elapsed(entry, now))}</Typography>
            <Typography variant="body2">{entry.task || entry.project || 'Untitled'} · {entry.status}</Typography>
            {entry.description && <Typography variant="body2">{entry.description}</Typography>}
            {issueKey && entry.task !== issueKey && <Alert severity="info">This timer belongs to {entry.task || 'another task'}. Stop it before starting this issue.</Alert>}
            <Stack direction="row" spacing={1}>
              {entry.status === 'running' && <Button variant="outlined" disabled={busy} onClick={() => run(async () => { await invoke('timerAction', { action: 'pause' }); await refresh(); })}>Pause</Button>}
              {entry.status === 'paused' && <Button variant="outlined" disabled={busy} onClick={() => run(async () => { await invoke('timerAction', { action: 'resume' }); await refresh(); })}>Resume</Button>}
              <Button color="error" variant="outlined" disabled={busy} onClick={() => run(async () => { await invoke('timerAction', { action: 'stop' }); await refresh(); })}>Stop</Button>
            </Stack>
          </> : <>
            <TextField label="Description" value={description} onChange={(event) => setDescription(event.target.value)} slotProps={{ htmlInput: { maxLength: 500 } }} fullWidth />
            <Button variant="contained" disabled={busy || !issueKey} onClick={() => run(async () => {
              await invoke('timerAction', { action: 'start', project, task: issueKey, description });
              await refresh();
            })}>Start timer for {issueKey || 'this issue'}</Button>
          </>}
        </Stack></CardContent></Card>
        <Card variant="outlined"><CardContent><Stack spacing={1}>
          <Typography variant="subtitle1">Recent time on this issue</Typography>
          {issueEntries.length === 0 && <Typography variant="body2">No recent entries.</Typography>}
          {issueEntries.map((item) => <Box key={item.id}>
            <Divider sx={{ mb: 1 }} />
            <Typography variant="body2">{duration(elapsed(item, now))} · {new Date(item.start_at).toLocaleString()}</Typography>
            {item.description && <Typography variant="body2" color="text.secondary">{item.description}</Typography>}
          </Box>)}
        </Stack></CardContent></Card>
        <Button size="small" disabled={busy} onClick={() => run(async () => {
          await invoke('disconnect'); setConnected(false); setEntry(null); setEntries([]);
        })}>Disconnect Timelogger</Button>
      </>}
    </Stack>
  </Box>;
}

function message(cause: unknown) {
  return cause instanceof Error ? cause.message : String(cause);
}

createRoot(document.getElementById('root')!).render(<App />);
