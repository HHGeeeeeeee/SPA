'use client';

import { Suspense, useState, useTransition } from 'react';
import { useSearchParams } from 'next/navigation';
import { Sparkles } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { login } from './actions';

// The form reads ?next= via useSearchParams, so it must sit under a Suspense
// boundary (otherwise the static prerender of /login bails out and the build
// fails). The page provides that boundary; the form is the client child.
function LoginForm() {
  const params = useSearchParams();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    startTransition(async () => {
      // On success the server action issues a server-side redirect (which also
      // commits the auth cookie), so control only returns here on failure.
      const r = await login({ username, password, next: params.get('next') ?? undefined });
      if (r && !r.ok) setError(r.error);
    });
  }

  return (
    <Card className="w-full max-w-sm">
      <CardHeader className="text-center">
        <div className="mx-auto mb-2 flex size-10 items-center justify-center rounded-xl bg-primary/15 text-primary">
          <Sparkles className="size-5" />
        </div>
        <CardTitle className="text-xl font-bold">HHG-SPA POS</CardTitle>
        <p className="text-sm font-medium text-muted-foreground">Sign in to continue</p>
      </CardHeader>
      <CardContent>
        <form onSubmit={submit} className="flex flex-col gap-4">
          <div className="flex flex-col gap-2">
            <Label htmlFor="username" className="font-semibold">Username</Label>
            <Input id="username" type="text" autoComplete="username" value={username} onChange={(e) => setUsername(e.target.value)} required autoFocus />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="password" className="font-semibold">Password</Label>
            <Input id="password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} required />
          </div>
          {error && <p className="text-sm font-semibold text-destructive">{error}</p>}
          <Button type="submit" disabled={pending} className="w-full">
            {pending ? 'Signing in…' : 'Sign in'}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}

export default function LoginPage() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-muted/30 p-4">
      <Suspense fallback={<div className="h-80 w-full max-w-sm animate-pulse rounded-xl border border-border bg-card" />}>
        <LoginForm />
      </Suspense>
    </div>
  );
}
