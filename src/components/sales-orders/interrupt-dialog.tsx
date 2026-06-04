'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { ShieldAlert } from 'lucide-react';

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
import { Textarea } from '@/components/ui/textarea';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

import { interruptOrderItem } from '@/app/(dashboard)/sales-orders/actions';
import {
  INTERRUPT_HANDLINGS,
  INTERRUPT_REASONS_BY_HANDLING,
  INTERRUPT_REASON_OTHER,
  type InterruptHandling,
} from '@/lib/interrupt-taxonomy';

interface PinManager { id: string; name: string }

interface Props {
  orderId: string;
  itemId: string;
  serviceName: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Pin-capable managers (active + has PIN set). Drives the PIN entry's
   *  Manager dropdown when staff picks No charge. Empty array means no
   *  manager has set a PIN — staff can't waive charges until someone does. */
  pinManagers: PinManager[];
  /** When true the caller IS a manager — no PIN entry needed for No charge,
   *  server records the caller's own id as the approver. */
  viewerIsManager: boolean;
}

export function InterruptDialog({
  orderId,
  itemId,
  serviceName,
  open,
  onOpenChange,
  pinManagers,
  viewerIsManager,
}: Props) {
  const [handling, setHandling] = useState<InterruptHandling>('full_charge');
  const [reasonCode, setReasonCode] = useState<string>('');
  const [notes, setNotes] = useState('');
  const [managerId, setManagerId] = useState<string>('');
  const [pin, setPin] = useState('');
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  // Reasons depend on handling — each billing mode has its own short list so
  // staff aren't picking from a 12-line salad. Picking a new handling resets
  // reasonCode so a stale value from a different mode can't get submitted.
  const reasons = INTERRUPT_REASONS_BY_HANDLING[handling];
  const requireNotes = reasonCode === INTERRUPT_REASON_OTHER;
  // PIN section visible only on the path that needs it — No charge by a
  // non-manager caller. Manager picks No charge → just submit, server logs
  // them as approver.
  const needPin = handling === 'no_charge' && !viewerIsManager;

  function submit() {
    if (!reasonCode) return toast.error('Pick a reason');
    if (requireNotes && notes.trim().length < 3) return toast.error('Notes required when reason is Other');
    if (needPin) {
      if (!managerId) return toast.error('Pick the approving manager');
      if (!/^\d{4,6}$/.test(pin)) return toast.error('PIN must be 4–6 digits');
    }
    startTransition(async () => {
      const r = await interruptOrderItem({
        item_id: itemId,
        order_id: orderId,
        handling,
        reason_code: reasonCode,
        notes: notes.trim() || null,
        manager_user_id: needPin ? managerId : null,
        manager_pin: needPin ? pin : null,
      });
      if (r.ok) {
        toast.success('Service interrupted');
        onOpenChange(false);
        router.refresh();
      } else if (r.error === 'NEED_MANAGER_PIN') {
        // Should be rare — viewerIsManager said true but server disagreed
        // (stale session?). Make the PIN inputs visible so user can retry.
        toast.error('Manager approval required');
      } else {
        toast.error(r.error);
      }
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle className="font-bold">Interrupt service</DialogTitle>
          <DialogDescription className="font-medium">{serviceName}</DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-3 py-3">
          <div className="flex flex-col gap-2">
            <Label className="font-semibold">Handling</Label>
            <Select
              items={INTERRUPT_HANDLINGS}
              value={handling}
              onValueChange={(v) => {
                if (!v) return;
                setHandling(v as InterruptHandling);
                setReasonCode('');
                // Clear PIN state when leaving No charge — keeps stale
                // manager/PIN out of the next submit on Full charge.
                if (v !== 'no_charge') {
                  setManagerId('');
                  setPin('');
                }
              }}
            >
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {INTERRUPT_HANDLINGS.map((h) => <SelectItem key={h.value} value={h.value}>{h.label}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="flex flex-col gap-2">
            <Label className="font-semibold">Reason</Label>
            <Select
              items={reasons}
              value={reasonCode}
              onValueChange={(v) => v && setReasonCode(v)}
            >
              <SelectTrigger><SelectValue placeholder="Pick a reason" /></SelectTrigger>
              <SelectContent>
                {reasons.map((r) => <SelectItem key={r.value} value={r.value}>{r.label}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="flex flex-col gap-2">
            <Label className="font-semibold">
              Notes{requireNotes && <span className="text-destructive"> *</span>}
            </Label>
            <Textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={3}
              placeholder={requireNotes ? 'Required — describe the reason' : 'Optional additional detail'}
            />
          </div>

          {needPin && (
            // Inline manager approval — staff can't waive a charge alone.
            // The manager taps their name + types their PIN on the staff's
            // device; server-side bcrypt verify + counts failed attempts
            // toward a 5-strike 15-minute lock per manager.
            <div className="rounded-md border border-amber-300 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/30 px-3 py-2 flex flex-col gap-2">
              <div className="flex items-center gap-2 text-xs font-bold text-amber-900 dark:text-amber-200">
                <ShieldAlert className="size-4" />
                Manager approval required
              </div>
              <div className="flex flex-col gap-1.5">
                <Label className="text-xs font-semibold">Manager</Label>
                {pinManagers.length === 0 ? (
                  <p className="text-xs font-medium text-destructive">
                    No manager has a PIN set — ask an admin to set one in Settings → Users.
                  </p>
                ) : (
                  <Select
                    items={pinManagers.map((m) => ({ value: m.id, label: m.name }))}
                    value={managerId}
                    onValueChange={(v) => v && setManagerId(v)}
                  >
                    <SelectTrigger><SelectValue placeholder="Pick a manager" /></SelectTrigger>
                    <SelectContent>
                      {pinManagers.map((m) => <SelectItem key={m.id} value={m.id}>{m.name}</SelectItem>)}
                    </SelectContent>
                  </Select>
                )}
              </div>
              <div className="flex flex-col gap-1.5">
                <Label className="text-xs font-semibold">PIN</Label>
                <Input
                  type="password"
                  inputMode="numeric"
                  autoComplete="off"
                  maxLength={6}
                  value={pin}
                  onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))}
                  placeholder="4–6 digits"
                  disabled={pinManagers.length === 0}
                />
              </div>
            </div>
          )}
        </div>
        <DialogFooter>
          <Button type="button" variant="ghost" onClick={() => onOpenChange(false)} disabled={pending}>Cancel</Button>
          <Button
            type="button"
            variant="destructive"
            onClick={submit}
            disabled={pending || (needPin && pinManagers.length === 0)}
          >
            {pending ? 'Working…' : 'Interrupt'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
