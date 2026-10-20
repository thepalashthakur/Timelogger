import { Alert, Box, Container, Typography } from '@mui/material';
import Dashboard from './dashboard';

export const dynamic = 'force-dynamic';

export default function Home() {
  const url = process.env.SUPABASE_URL;
  const anonKey = process.env.SUPABASE_ANON_KEY;
  if (!url || !anonKey) {
    return <Container sx={{ py: 6 }}><Box><Typography variant="h4" gutterBottom>Timelogger setup</Typography><Alert severity="info">Set SUPABASE_URL and SUPABASE_ANON_KEY to use the app.</Alert></Box></Container>;
  }
  return <Dashboard supabaseUrl={url} supabaseAnonKey={anonKey} />;
}
