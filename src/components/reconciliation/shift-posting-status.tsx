'use client';

import { useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Check, TriangleAlert, RotateCcw } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { retryShiftPosting } from '@/app/(dashboard)/reconciliation/shift-remittance/actions';

// ERP posting state for a closed shift: green when the GL journal posted (with
// the Acumatica batch number), red + Retry when it failed, and a muted "not
// posted yet" + Retry when it hasn't gone out (e.g. Acumatica not yet configured,
// so the close-time post was skipped). Manager-only Retry.
export function ShiftPostingStatus({
  shiftId,
  postingStatus,
  glBatchNbr,
  postingError,
  canRetry,
}: {
  shiftId: string;
  postingStatus: string | null;
  glBatchNbr: string | null;
  postingError: string | null;
  canRetry: boolean;
}) {
  const [pending, start] = useTransition();
  const router = useRouter();

  function retry() {
    start(async () => {
      const r = await retryShiftPosting(shiftId);
      if (r.ok) { toast.success('Re-posted to ERP'); router.refresh(); }
      else toast.error(r.error);
    });
  }

  const retryBtn = canRetry ? (
    <Button size="sm" variant="outline" onClick={retry} disabled={pending}>
      <RotateCcw className="size-3.5" /> {pending ? 'Posting…' : 'Retry post'}
    </Button>
  ) : null;

  if (postingStatus === 'posted') {
    return (
      <div className="flex items-center gap-2 text-sm font-semibold text-primary">
        <Check className="size-4" /> Posted to ERP{glBatchNbr ? ` · GL #${glBatchNbr}` : ''}
      </div>
    );
  }
  if (postingStatus === 'failed') {
    return (
      <div className="flex flex-wrap items-center gap-2">
        <span className="flex items-center gap-1.5 text-sm font-semibold text-destructive">
          <TriangleAlert className="size-4" /> ERP posting failed
        </span>
        {postingError && <span className="text-xs font-medium text-muted-foreground">{postingError}</span>}
        {retryBtn}
      </div>
    );
  }
  if (postingStatus === 'posting') {
    return <div className="text-sm font-semibold text-muted-foreground">Posting to ERP…</div>;
  }
  // null → never posted (skipped, e.g. Acumatica not configured).
  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="text-sm font-medium text-muted-foreground">Not posted to ERP yet.</span>
      {retryBtn}
    </div>
  );
}