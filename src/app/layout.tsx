import type { Metadata } from 'next';
import { AppRouterCacheProvider } from '@mui/material-nextjs/v16-appRouter';
import InitColorSchemeScript from '@mui/material/InitColorSchemeScript';
import TimeloggerThemeProvider from './theme-provider';

export const metadata: Metadata = { title: 'Timelogger', description: 'Track time with clarity' };

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en" suppressHydrationWarning><body><InitColorSchemeScript attribute="class" defaultMode="system" modeStorageKey="timelogger-appearance" /><AppRouterCacheProvider><TimeloggerThemeProvider>{children}</TimeloggerThemeProvider></AppRouterCacheProvider></body></html>;
}
