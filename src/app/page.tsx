import { Alert, Box, Container, Typography } from '@mui/material';
import Dashboard from './dashboard';

export const dynamic = 'force-dynamic';

export default function Home() {
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_ANON_KEY || !process.env.USEAUTH_URL) {
    return <Container sx={{ py: 6 }}><Box><Typography variant="h4" gutterBottom>Timelogger setup</Typography><Alert severity="info">Set SUPABASE_URL, SUPABASE_ANON_KEY, and USEAUTH_URL to use the app.</Alert></Box></Container>;
  }
  return <Dashboard />;
}
