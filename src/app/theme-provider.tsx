'use client';

import { CssBaseline } from '@mui/material';
import { createTheme, ThemeProvider } from '@mui/material/styles';

const theme = createTheme({
  colorSchemes: { light: true, dark: true },
  cssVariables: { colorSchemeSelector: 'class' },
});

export default function TimeloggerThemeProvider({ children }: { children: React.ReactNode }) {
  return <ThemeProvider theme={theme} defaultMode="system" modeStorageKey="timelogger-appearance"><CssBaseline enableColorScheme />{children}</ThemeProvider>;
}
