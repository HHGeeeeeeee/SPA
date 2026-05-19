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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

import { createPosition, updatePosition } from '@/app/(dashboard)/settings/positions/actions';

export interface PositionItem {
  id: string;
  code: string;
  name: string;
  business_unit: string;
}

interface Props {
  mode?: 'create' | 'edit';
  item?: PositionItem;
  trigger?: React.ReactNode;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}

const UNIT_OPTIONS = [
  { value: 'spa', label: 'SPA' },
  { value: 'gym', label: 'Gym (future)' },
  { value: 'shared', label: 'Shared' },
];

export function PositionFormDialog({
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
  const [businessUnit, setBusinessUnit] = useState(item?.business_unit ?? 'spa');

  const isEdit = mode === 'edit';

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    startTransition(async () => {
      const r = isEdit
        ? await updatePosition({ id: item!.id, name, business_unit: businessUnit })
        : await createPosition({ code, name, business_unit: businessUnit });
      if (r.ok) {
        toast.success(isEdit ? 'Position updated' : 'Position created');
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
              {isEdit ? `Edit Position: ${item?.code}` : 'New Position'}
            </DialogTitle>
            <DialogDescription className="font-medium">
              {isEdit
                ? 'Code is immutable. Name and unit can be changed.'
                : 'HR job title for employees (e.g. Massage Therapist).'}
            </DialogDescription>
          </DialogHeader>

          <div className="flex flex-col gap-4 py-4">
            <div className="flex flex-col gap-2">
              <Label htmlFor="pos-code" className="font-semibold">Code *</Label>
              <Input
                id="pos-code"
                value={code}
                onChange={(e) => setCode(e.target.value.toUpperCase().replace(/[^A-Z0-9_-]/g, ''))}
                placeholder="MASSAGE_THERAPIST"
                disabled={isEdit}
                required
                maxLength={40}
              />
              <p className="text-xs font-medium text-muted-foreground">
                Uppercase letters, digits, - and _ only. Cannot be changed later.
              </p>
            </div>

            <div className="flex flex-col gap-2">
              <Label htmlFor="pos-name" className="font-semibold">Display Name *</Label>
              <Input
                id="pos-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Massage Therapist"
                required
                maxLength={80}
              />
            </div>

            <div className="flex flex-col gap-2">
              <Label className="font-semibold">Business Unit *</Label>
              <Select items={UNIT_OPTIONS} value={businessUnit} onValueChange={(v) => v && setBusinessUnit(v)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {UNIT_OPTIONS.map((opt) => (
                    <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs font-medium text-muted-foreground">
                <strong>Business line</strong>, not a branch. SPA = SPA only; Gym = future gym
                line; Shared = used by both SPA and Gym (e.g. Receptionist). Cross-branch
                staffing is handled by the shift schedule, not this field.
              </p>
            </div>
          </div>

          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => setOpen(false)} disabled={pending}>
              Cancel
            </Button>
            <Button type="submit" disabled={pending}>
              {pending ? 'Saving…' : isEdit ? 'Save changes' : 'Create position'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
