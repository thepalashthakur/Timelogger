'use client';

import { MenuItem, TextField } from '@mui/material';
import { useColorScheme } from '@mui/material/styles';

export default function AppearanceControl() {
  const { mode, setMode } = useColorScheme();

  return <TextField select label="Appearance" size="small" value={mode ?? 'system'}
    onChange={(event) => setMode(event.target.value as 'system' | 'light' | 'dark')}
    sx={{ minWidth: 125 }}>
    <MenuItem value="system">System</MenuItem>
    <MenuItem value="light">Light</MenuItem>
    <MenuItem value="dark">Dark</MenuItem>
  </TextField>;
}
