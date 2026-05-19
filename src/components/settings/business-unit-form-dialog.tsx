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
  createBusinessUnit,
  updateBusinessUnit,
} from '@/app/(dashboard)/settings/business-units/actions';

export interface BusinessUnitItem {
  id: string;
  code: string;
  name: string;
}

interface Props {
  mode?: 'create' | 'edit';
  item?: BusinessUnitItem;
  trigger?: React.ReactNode;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}

export function BusinessUnitFormDialog({
  mode = 'create',
  item,
  trigger,
  open: controlledOpen,
  onOpenChange: controlledOnOpenChange,
}: Props) {
  const [internalOpen, setInternalOpen] = useState(false);
  const open = controlledOpen ?? internalOpen;
  const setOpen = controlledOnOpenChange ?? setInternalOpen;
  const [pending, startTransition] = useTransition();

  const [code, setCode] = useState(item?.code ?? '');
  const [name, setName] = useState(item?.name ?? '');

  const isEdit = mode === 'edit';

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    startTransition(async () => {
      const r = isEdit
        ? await updateBusinessUnit({ id: item!.id, name })
        : await createBusinessUnit({ code, name });
      if (r.ok) {
        toast.success(isEdit ? 'Business unit updated' : 'Business unit created');
        setOpen(false);
        if (!isEdit) {
          setCode('');
          setName('');
        }
      } else {
        toast.error(r.error);
      }
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      {trigger ? (
        <DialogTrigger render={trigger as React.ReactElement} />
      ) : null}
      <DialogContent className="sm:max-w-md">
        <form onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle className="font-bold">
              {isEdit ? `Edit Business Unit: ${item?.code}` : 'New Business Unit'}
            </DialogTitle>
            <DialogDescription className="font-medium">
              A business line (SPA, Gym, Restaurant, …). Drives which services, positions,
              and resources belong where.
            </DialogDescription>
          </DialogHeader>

          <div className="flex flex-col gap-4 py-4">
            <div className="flex flex-col gap-2">
              <Label htmlFor="bu-code" className="font-semibold">Code *</Label>
              <Input
                id="bu-code"
                value={code}
                onChange={(e) => setCode(e.target.value.toLowerCase().replace(/[^a-z0-9_-]/g, ''))}
                placeholder="spa / gym / restaurant"
                disabled={isEdit}
                required
                maxLength={40}
              />
              <p className="text-xs font-medium text-muted-foreground">
                Lowercase letters, digits, - and _ only. Cannot be changed later.
              </p>
            </div>

            <div className="flex flex-col gap-2">
              <Label htmlFor="bu-name" className="font-semibold">Display Name *</Label>
              <Input
                id="bu-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="SPA / Gym / Restaurant"
                required
                maxLength={80}
              />
            </div>
          </div>

          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => setOpen(false)} disabled={pending}>
              Cancel
            </Button>
            <Button type="submit" disabled={pending}>
              {pending ? 'Saving…' : isEdit ? 'Save changes' : 'Create business unit'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
