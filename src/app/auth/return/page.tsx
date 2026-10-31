import { Button, Container, Stack, Typography } from '@mui/material';
import { ssoConfig } from '@/lib/sso';

export const metadata = { title: 'Continue to Time Logger' };
export const dynamic = 'force-dynamic';

export default async function AuthReturn({ searchParams }: {
  searchParams: Promise<{ result?: string }>;
}) {
  const updated = (await searchParams).result === 'password-updated';
  return (
    <Container maxWidth="sm" sx={{ py: 8 }}>
      <Stack spacing={2}>
        <Typography variant="h4" component="h1">
          {updated ? 'Password updated' : 'Email confirmed'}
        </Typography>
        <Typography>
          Continue with MyCodex to sign in to this account. If another account
          was already open here, signing in will switch the account used by Time Logger.
        </Typography>
        {ssoConfig() ? (
          <Button variant="contained" href="/auth/sso/start">
            Continue with MyCodex
          </Button>
        ) : (
          <Button variant="contained" href="/">
            Open Time Logger
          </Button>
        )}
      </Stack>
    </Container>
  );
}
