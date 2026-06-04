'use client';

import { useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Plus } from 'lucide-react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { createQuickDraft } from '@/app/(dashboard)/sales-orders/actions';

/**
 * One-click New Order — no dialog. Creates a draft with default branch / source /
 * billing (all editable on the order screen) and jumps straight in, so the desk
 * goes service-first instead of filling a confirmation form.
 */
export function NewOrderButton({ disabled }: { disabled?: boolean }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  function go() {
    start(async () => {
      const r = await createQuickDraft();
      if (r.ok && r.data) router.push(`/sales-orders/${r.data.id}`);
      else if (!r.ok) toast.error(r.error);
    });
  }
  return (
    <Button onClick={go} disabled={disabled || pending}>
      <Plus className="size-4" />
      {pending ? 'Creating…' : 'New Order'}
    </Button>
  );
}
