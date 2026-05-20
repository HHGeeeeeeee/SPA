'use client';

import { useState, useTransition } from 'react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

import { setStaffUserPassword } from '@/app/(dashboard)/settings/users/actions';

interface Props {
  userId: string;
  username: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function UserPasswordDialog({ userId, username, open, onOpenChange }: Props) {
  const [pwd, setPwd] = useState('');
  const [confirm, setConfirm] = useState('');
  const [pending, startTransition] = useTransition();

  function save() {
    if (pwd.length < 8) return toast.error('Password must be at least 8 characters');
    if (pwd !== confirm) return toast.error('Passwords do not match');
    startTransition(async () => {
      const r = await setStaffUserPassword({ id: userId, password: pwd });
      if (r.ok) {
        toast.success('Password set');
        setPwd('');
        setConfirm('');
        onOpenChange(false);
      } else {
        toast.error(r.error);
      }
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle className="font-bold">Set Password · {username}</DialogTitle>
          <DialogDescription className="font-medium">
            The user signs in with their email and this password.
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-3 py-3">
          <div className="flex flex-col gap-2">
            <Label htmlFor="np" className="font-semibold">New password</Label>
            <Input id="np" type="password" value={pwd} onChange={(e) => setPwd(e.target.value)} autoComplete="new-password" />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="np2" className="font-semibold">Confirm password</Label>
            <Input id="np2" type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} autoComplete="new-password" />
          </div>
        </div>
        <DialogFooter>
          <Button type="button" variant="ghost" onClick={() => onOpenChange(false)} disabled={pending}>Cancel</Button>
          <Button type="button" onClick={save} disabled={pending}>{pending ? 'Saving…' : 'Set password'}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
