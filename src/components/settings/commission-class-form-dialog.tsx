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

import {
  createCommissionClass,
  updateCommissionClass,
} from '@/app/(dashboard)/settings/commission-classes/actions';

interface Props {
  mode?: 'create' | 'edit';
  item?: { id: string; class_code: string; name: string; commission_rate: number };
  trigger?: React.ReactNode;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}

export function CommissionClassFormDialog({
  mode = 'create',
  item,
  trigger,
  open: controlledOpen,
  onOpenChange: controlledOnOpenChange,
}: Props) {
  const [internalOpen, setInternalOpen] = useState(false);
  const open = controlledOpen ?? internalOpen;
  const setOpen = controlledOnOpenChange ?? setInternalOpen;
  const [classCode, setClassCode] = useState(item?.class_code ?? '');
  const [name, setName] = useState(item?.name ?? '');
  const [ratePercent, setRatePercent] = useState(
    item ? String(Math.round(item.commission_rate * 1000) / 10) : '',
  );
  const [pending, startTransition] = useTransition();

  const isEdit = mode === 'edit';

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    startTransition(async () => {
      const result = isEdit
        ? await updateCommissionClass({ id: item!.id, name, rate_percent: ratePercent })
        : await createCommissionClass({ class_code: classCode, name, rate_percent: ratePercent });
      if (result.ok) {
        toast.success(isEdit ? 'Class updated' : 'Class created');
        setOpen(false);
        if (!isEdit) {
          setClassCode('');
          setName('');
          setRatePercent('');
        }
      } else {
        toast.error(result.error);
      }
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      {trigger ? (
        <DialogTrigger nativeButton={false} render={trigger as React.ReactElement} />
      ) : null}
      <DialogContent className="sm:max-w-md">
        <form onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle className="font-bold">
              {isEdit ? `Edit Class: ${item?.class_code}` : 'New Commission Class'}
            </DialogTitle>
            <DialogDescription className="font-medium">
              {isEdit
                ? 'Class code is immutable. Rate changes affect future OrderItems only.'
                : 'Define a new therapist commission tier.'}
            </DialogDescription>
          </DialogHeader>

          <div className="flex flex-col gap-4 py-4">
            <div className="flex flex-col gap-2">
              <Label htmlFor="cc-code" className="font-semibold">
                Class Code *
              </Label>
              <Input
                id="cc-code"
                value={classCode}
                onChange={(e) => setClassCode(e.target.value.toUpperCase())}
                placeholder="M / S / J"
                disabled={isEdit}
                required
                maxLength={10}
              />
            </div>

            <div className="flex flex-col gap-2">
              <Label htmlFor="cc-name" className="font-semibold">
                Name *
              </Label>
              <Input
                id="cc-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Master / Senior / Junior"
                required
                maxLength={60}
              />
            </div>

            <div className="flex flex-col gap-2">
              <Label htmlFor="cc-rate" className="font-semibold">
                Commission Rate (%) *
              </Label>
              <Input
                id="cc-rate"
                type="number"
                step="0.01"
                min="0"
                max="100"
                value={ratePercent}
                onChange={(e) => setRatePercent(e.target.value)}
                placeholder="30"
                required
              />
              <p className="text-xs font-medium text-muted-foreground">
                Percentage of gross sales. Stored internally as decimal (e.g. 30% → 0.3000).
              </p>
            </div>
          </div>

          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => setOpen(false)} disabled={pending}>
              Cancel
            </Button>
            <Button type="submit" disabled={pending}>
              {pending ? 'Saving…' : isEdit ? 'Save changes' : 'Create class'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
