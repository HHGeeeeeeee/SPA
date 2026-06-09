'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { TabletSmartphone } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { armKiosk, type KioskBranchOpt } from '@/app/(kiosk)/kiosk/actions';

/**
 * Staff-facing one-time setup: pick the branch + enter that branch's kiosk
 * passcode to arm the tablet. After this the public intake form loops for guests
 * with no further login. Deliberately English-only (staff surface).
 */
export function ArmScreen({ branches }: { branches: KioskBranchOpt[] }) {
  const router = useRouter();
  const [branchId, setBranchId] = useState(branches[0]?.id ?? '');
  const [passcode, setPasscode] = useState('');
  const [pending, startTransition] = useTransition();

  function arm() {
    if (!branchId) return toast.error('Pick a branch');
    startTransition(async () => {
      const res = await armKiosk(branchId, passcode);
      if (res.ok) {
        setPasscode('');
        router.refresh();
      } else {
        toast.error(res.error);
      }
    });
  }

  return (
    <div className="flex min-h-screen items-center justify-center p-6">
      <div className="w-full max-w-sm rounded-2xl border border-border bg-card p-8 shadow-sm">
        <div className="mb-6 flex flex-col items-center gap-3 text-center">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/kiosk-logo.png" alt="H Signature" className="h-16 w-auto" />
          <TabletSmartphone className="size-8 text-primary" />
          <div>
            <h1 className="text-xl font-bold">Set up this tablet</h1>
            <p className="mt-1 text-sm font-medium text-muted-foreground">
              Choose the branch and enter its kiosk passcode. The guest form will
              then run on its own.
            </p>
          </div>
        </div>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            arm();
          }}
          className="flex flex-col gap-4"
        >
          <div className="flex flex-col gap-2">
            <Label className="font-semibold">Branch</Label>
            <select
              value={branchId}
              onChange={(e) => setBranchId(e.target.value)}
              className="h-11 rounded-md border border-input bg-background px-3 text-base font-medium"
            >
              {branches.length === 0 && <option value="">No active branches</option>}
              {branches.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.code} — {b.name}
                </option>
              ))}
            </select>
          </div>

          <div className="flex flex-col gap-2">
            <Label className="font-semibold">Kiosk passcode</Label>
            <Input
              type="password"
              value={passcode}
              onChange={(e) => setPasscode(e.target.value)}
              className="h-11 text-base"
              autoComplete="off"
            />
          </div>

          <Button type="submit" size="lg" className="mt-2 h-12" disabled={pending}>
            {pending ? 'Starting…' : 'Start kiosk'}
          </Button>
        </form>
      </div>
    </div>
  );
}
