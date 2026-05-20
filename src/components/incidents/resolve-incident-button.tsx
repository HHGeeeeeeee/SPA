'use client';

import { useState, useTransition } from 'react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';

import { resolveIncident } from '@/app/(dashboard)/incidents/actions';

export function ResolveIncidentButton({ id }: { id: string }) {
  const [open, setOpen] = useState(false);
  const [action, setAction] = useState('');
  const [pending, startTransition] = useTransition();

  return (
    <>
      <Button size="sm" variant="outline" onClick={() => setOpen(true)}>Resolve</Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader><DialogTitle className="font-bold">Resolve incident</DialogTitle></DialogHeader>
          <div className="flex flex-col gap-2 py-3">
            <Label className="font-semibold">Resolution action</Label>
            <Textarea value={action} onChange={(e) => setAction(e.target.value)} rows={3} placeholder="What was done" />
          </div>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => setOpen(false)} disabled={pending}>Cancel</Button>
            <Button
              type="button"
              onClick={() => startTransition(async () => {
                const r = await resolveIncident(id, action);
                if (r.ok) { toast.success('Resolved'); setOpen(false); } else toast.error(r.error);
              })}
              disabled={pending}
            >
              {pending ? 'Saving…' : 'Mark resolved'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
