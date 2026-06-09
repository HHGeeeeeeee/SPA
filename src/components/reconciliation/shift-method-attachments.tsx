'use client';

import { useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Paperclip, ExternalLink, Trash2, Upload } from 'lucide-react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import {
  uploadShiftAttachment,
  getShiftAttachmentUrl,
  deleteShiftAttachment,
  type ShiftAttachment,
} from '@/app/(dashboard)/reconciliation/shift-remittance/actions';

function fmt(iso: string): string {
  return new Date(iso).toLocaleString('en-PH', { timeZone: 'Asia/Manila', dateStyle: 'medium', timeStyle: 'short' });
}

// Attachment control for one payment-method row: a paperclip button carrying the
// file count that opens a dialog to upload (image / PDF), view (signed URL), and
// remove the cash-photo / card-settlement evidence for that method.
export function ShiftMethodAttachments({
  shiftId,
  methodCode,
  methodLabel,
  items,
}: {
  shiftId: string;
  methodCode: string;
  methodLabel: string;
  items: ShiftAttachment[];
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  const fileRef = useRef<HTMLInputElement>(null);

  function onPick(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const fd = new FormData();
    fd.set('file', file);
    fd.set('shift_id', shiftId);
    fd.set('method_code', methodCode);
    start(async () => {
      const r = await uploadShiftAttachment(fd);
      if (fileRef.current) fileRef.current.value = '';
      if (r.ok) { toast.success('File attached'); router.refresh(); }
      else toast.error(r.error);
    });
  }

  function view(id: string) {
    start(async () => {
      const r = await getShiftAttachmentUrl(id);
      if (r.ok) window.open(r.url, '_blank', 'noopener');
      else toast.error(r.error);
    });
  }

  function remove(id: string) {
    start(async () => {
      const r = await deleteShiftAttachment(id);
      if (r.ok) { toast.success('Attachment removed'); router.refresh(); }
      else toast.error(r.error);
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        render={
          <button
            type="button"
            className="ml-auto inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-xs font-semibold text-muted-foreground hover:bg-muted/60"
            title="Attach cash photo / settlement slip"
          >
            <Paperclip className="size-3.5" />
            {items.length > 0 ? items.length : 'Attach'}
          </button>
        }
      />
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{methodLabel} — attachments</DialogTitle>
          <DialogDescription>Cash drawer photos or card/PAYMAYA settlement slips for this method. Images or PDF, up to 10&nbsp;MB.</DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-2">
          {items.length === 0 ? (
            <p className="py-2 text-sm font-medium text-muted-foreground">No files attached yet.</p>
          ) : (
            items.map((a) => (
              <div key={a.id} className="flex items-center gap-2 rounded-md border border-border px-2.5 py-1.5">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold">{a.fileName}</p>
                  <p className="text-[11px] text-muted-foreground">{fmt(a.uploadedAt)}{a.uploadedByName ? ` · ${a.uploadedByName}` : ''}</p>
                </div>
                <button type="button" onClick={() => view(a.id)} disabled={pending} className="inline-flex items-center gap-1 text-xs font-bold text-primary hover:underline disabled:opacity-50">
                  View <ExternalLink className="size-3" />
                </button>
                <button type="button" onClick={() => remove(a.id)} disabled={pending} className="text-muted-foreground hover:text-destructive disabled:opacity-50" title="Remove">
                  <Trash2 className="size-4" />
                </button>
              </div>
            ))
          )}
        </div>

        <input
          ref={fileRef}
          type="file"
          accept="image/*,application/pdf"
          className="hidden"
          onChange={onPick}
        />
        <Button type="button" variant="outline" className="self-start" disabled={pending} onClick={() => fileRef.current?.click()}>
          <Upload className="size-4" /> {pending ? 'Uploading…' : 'Upload file'}
        </Button>
      </DialogContent>
    </Dialog>
  );
}
