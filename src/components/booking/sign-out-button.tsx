'use client';

import { LogOut } from 'lucide-react';
import { Button } from '@/components/ui/button';

export function SignOutButton() {
  // POST (never a prefetchable GET) so the router doesn't silently log the user
  // out; then hard-navigate so the cleared cookie takes effect.
  async function signOut() {
    try {
      await fetch('/api/auth/logout', { method: 'POST' });
    } finally {
      window.location.assign('/login');
    }
  }
  return (
    <Button variant="ghost" onClick={signOut} className="gap-2 text-destructive hover:text-destructive">
      <LogOut className="size-4" /> Sign Out
    </Button>
  );
}