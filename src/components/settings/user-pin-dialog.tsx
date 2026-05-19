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
  DialogTrigger,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

import { setManagerPin } from '@/app/(dashboard)/settings/users/actions';

interface Props {
  userId: string;
  username: string;
  trigger: React.ReactNode;
}

export function UserPinDialog({ userId, username, trigger }: Props) {
  const [open, setOpen] = useState(false);
  const [pin, setPin] = useState('');
  const [confirmPin, setConfirmPin] = useState('');
  const [pending, startTransition] = useTransition();

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (pin !== confirmPin) {
      toast.error('PIN and confirmation do not match');
      return;
    }
    startTransition(async () => {
      const r = await setManagerPin({ id: userId, pin });
      if (r.ok) {
        toast.success('Manager PIN updated');
        setOpen(false);
        setPin('');
        setConfirmPin('');
      } else {
        toast.error(r.error);
      }
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger nativeButton={false} render={trigger as React.ReactElement} />
      <DialogContent className="sm:max-w-sm">
        <form onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle className="font-bold">Set Manager PIN</DialogTitle>
            <DialogDescription className="font-medium">
              4–6 digit PIN for <span className="font-mono">{username}</span>. Used for quick
              approval (Void, DIS-90,撤銷結帳).
            </DialogDescription>
          </DialogHeader>

          <div className="flex flex-col gap-4 py-4">
            <div className="flex flex-col gap-2">
              <Label htmlFor="pin-1" className="font-semibold">New PIN *</Label>
              <Input
                id="pin-1"
                type="password"
                inputMode="numeric"
                pattern="\d{4,6}"
                value={pin}
                onChange={(e) => setPin(e.target.value.replace(/\D/g, '').slice(0, 6))}
                required
                autoComplete="new-password"
              />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="pin-2" className="font-semibold">Confirm PIN *</Label>
              <Input
                id="pin-2"
                type="password"
                inputMode="numeric"
                pattern="\d{4,6}"
                value={confirmPin}
                onChange={(e) => setConfirmPin(e.target.value.replace(/\D/g, '').slice(0, 6))}
                required
                autoComplete="new-password"
              />
            </div>
            <p className="text-xs font-medium text-muted-foreground">
              PIN is bcrypt-hashed in storage. 5 failed attempts auto-lock for 15 minutes.
            </p>
          </div>

          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => setOpen(false)} disabled={pending}>
              Cancel
            </Button>
            <Button type="submit" disabled={pending || pin.length < 4 || pin !== confirmPin}>
              {pending ? 'Saving…' : 'Set PIN'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
