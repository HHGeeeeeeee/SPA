'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { toast } from 'sonner';
import { AlertTriangle, CalendarX } from 'lucide-react';

import { Button } from '@/components/ui/button';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import { forceCloseBusinessDay } from '@/app/(dashboard)/reconciliation/end-of-day/actions';

export interface OverdueCloseInfo {
  branch_id: string;
  branch_code: string;
  business_date: string;
  days_overdue: number;
}

/**
 * Daily-close discipline banner. Shows on dashboard + reconciliation hub when
 * any branch has an open business day older than yesterday.
 *
 * - 1 day overdue → amber warning, operations still allowed
 * - 2+ days overdue → red error, financial actions blocked until force-close
 *
 * The "Force-close" CTA is gated to manager (the server action enforces it;
 * here we just render the button when there's anything to force).
 */
export function OverdueCloseBanner({ items, canForce }: { items: OverdueCloseInfo[]; canForce: boolean }) {
  const router = useRouter();
  const [target, setTarget] = useState<OverdueCloseInfo | null>(null);
  const [reason, setReason] = useState('');
  const [pending, startTransition] = useTransition();

  if (items.length === 0) return null;
  const maxOverdue = Math.max(...items.map((i) => i.days_overdue));
  const blocking = maxOverdue >= 2;

  function doForce() {
    if (!target) return;
    if (reason.trim().length < 5) { toast.error('Reason required (5 chars+)'); return; }
    startTransition(async () => {
      const r = await forceCloseBusinessDay(target.branch_id, target.business_date, reason.trim());
      if (r.ok) {
        toast.success(`${target.branch_code} ${target.business_date} force-closed`);
        setTarget(null);
        setReason('');
        router.refresh();
      } else {
        toast.error(r.error);
      }
    });
  }

  return (
    <>
      <div className={cn(
        'flex flex-col gap-2 rounded-xl border px-4 py-3',
        blocking
          ? 'border-destructive/40 bg-destructive/5'
          : 'border-amber-500/40 bg-amber-500/5',
      )}>
        <div className="flex items-start gap-2">
          {blocking ? (
            <AlertTriangle className="size-5 shrink-0 text-destructive mt-0.5" />
          ) : (
            <CalendarX className="size-5 shrink-0 text-amber-700 dark:text-amber-400 mt-0.5" />
          )}
          <div className="flex-1 min-w-0">
            <p className={cn(
              'text-sm font-bold',
              blocking ? 'text-destructive' : 'text-amber-800 dark:text-amber-300',
            )}>
              {blocking
                ? 'Business day not closed — financial actions are blocked.'
                : 'Reminder: yesterday\'s business day is not closed yet.'}
            </p>
            <p className={cn(
              'text-xs font-medium mt-0.5',
              blocking ? 'text-destructive/80' : 'text-amber-700/80 dark:text-amber-400/80',
            )}>
              {blocking
                ? 'Revenue Confirm / SOA Settle / Tip Settlement / Commission Settlement won\'t run until the day is closed (or force-closed by a manager with a reason).'
                : 'Close it today on End-of-Day to keep books current.'}
            </p>
          </div>
        </div>

        <ul className="flex flex-col gap-1 ml-7">
          {items.map((i) => (
            <li key={`${i.branch_id}-${i.business_date}`} className="flex items-center justify-between gap-3 text-sm">
              <span className="font-semibold">
                <span className="font-mono font-bold">{i.branch_code}</span>
                <span className="mx-2 text-muted-foreground">·</span>
                {i.business_date}
                <span className={cn(
                  'ml-2 inline-flex items-center rounded px-1.5 py-0.5 text-[11px] font-bold',
                  i.days_overdue >= 2
                    ? 'bg-destructive/15 text-destructive'
                    : 'bg-amber-500/15 text-amber-700 dark:text-amber-300',
                )}>
                  {i.days_overdue}d overdue
                </span>
              </span>
              <div className="flex items-center gap-2 shrink-0">
                <Link
                  href={`/reconciliation/end-of-day?branch=${i.branch_id}&date=${i.business_date}`}
                  className="text-xs font-bold text-primary hover:underline"
                >
                  Go to EoD
                </Link>
                {canForce && (
                  <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => setTarget(i)}>
                    Force-close
                  </Button>
                )}
              </div>
            </li>
          ))}
        </ul>
      </div>

      <AlertDialog open={!!target} onOpenChange={(o) => { if (!o) { setTarget(null); setReason(''); } }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Force-close {target?.branch_code} · {target?.business_date}?</AlertDialogTitle>
            <AlertDialogDescription>
              This seals the business day without going through the normal Review → Balance → Revenue Confirm flow. Audit-logged with your name + reason. Use only when the day genuinely can&apos;t be reconstructed — when possible, finish the proper EoD steps instead.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="flex flex-col gap-2">
            <Label htmlFor="force-close-reason" className="text-xs font-bold">Reason (required)</Label>
            <Input
              id="force-close-reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="e.g. cashier forgot to close; counts verified next morning"
              disabled={pending}
            />
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={pending}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={doForce}
              disabled={pending || reason.trim().length < 5}
              className="bg-destructive text-white hover:bg-destructive/90"
            >
              {pending ? 'Sealing…' : 'Force-close'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
