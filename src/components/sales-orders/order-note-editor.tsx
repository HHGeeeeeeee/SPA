'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Check } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { updateOrderNote } from '@/app/(dashboard)/sales-orders/actions';

// The order note stays editable in any status — front desk can keep updating it
// (van schedule, allergy changes, etc.) even after the order is closed.
export function OrderNoteEditor({ orderId, initialNote }: { orderId: string; initialNote: string | null }) {
  const [note, setNote] = useState(initialNote ?? '');
  const [saved, setSaved] = useState(initialNote ?? '');
  const [pending, start] = useTransition();
  const router = useRouter();
  const dirty = note.trim() !== saved.trim();

  function save() {
    start(async () => {
      const r = await updateOrderNote({ order_id: orderId, note: note.trim() || null });
      if (r.ok) { setSaved(note.trim()); toast.success('Note saved'); router.refresh(); }
      else toast.error(r.error);
    });
  }

  return (
    <div className="mt-4 rounded-lg border border-border bg-muted/20 p-3">
      <div className="mb-1.5 flex items-center justify-between">
        <span className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Note</span>
        {dirty ? (
          <Button size="sm" onClick={save} disabled={pending}>{pending ? 'Saving…' : 'Save note'}</Button>
        ) : (
          saved && <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-muted-foreground"><Check className="size-3" /> Saved</span>
        )}
      </div>
      <Textarea
        value={note}
        onChange={(e) => setNote(e.target.value)}
        rows={2}
        placeholder="Add a note — editable any time, even after closing."
        className="bg-background"
      />
    </div>
  );
}
