import type { Metadata } from 'next';
import { AppRouterCacheProvider } from '@mui/material-nextjs/v16-appRouter';
import { CssBaseline } from '@mui/material';

export const metadata: Metadata = { title: 'Timelogger', description: 'Track time with clarity' };

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body><AppRouterCacheProvider><CssBaseline />{children}</AppRouterCacheProvider></body></html>;
}
