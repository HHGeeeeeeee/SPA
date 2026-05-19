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

import { createPosition, updatePosition } from '@/app/(dashboard)/settings/positions/actions';

export interface PositionItem {
  id: string;
  code: string;
  name: string;
  business_unit_ids: string[];
}

interface BusinessUnitOption {
  id: string;
  code: string;
  name: string;
}

interface Props {
  mode?: 'create' | 'edit';
  item?: PositionItem;
  businessUnits: BusinessUnitOption[];
  trigger?: React.ReactNode;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}

export function PositionFormDialog({
  mode = 'create',
  item,
  businessUnits,
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
  const [unitIds, setUnitIds] = useState<string[]>(item?.business_unit_ids ?? []);

  const isEdit = mode === 'edit';

  function toggleUnit(id: string) {
    setUnitIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
    );
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (unitIds.length === 0) {
      toast.error('Pick at least one business unit');
      return;
    }
    startTransition(async () => {
      const r = isEdit
        ? await updatePosition({ id: item!.id, name, business_unit_ids: unitIds })
        : await createPosition({ code, name, business_unit_ids: unitIds });
      if (r.ok) {
        toast.success(isEdit ? 'Position updated' : 'Position created');
        setOpen(false);
        if (!isEdit) {
          setCode('');
          setName('');
          setUnitIds([]);
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
                ? 'Code is immutable. Name and applicable business units can be changed.'
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
              <Label className="font-semibold">Applies To Business Units *</Label>
              <div className="flex flex-col gap-1 rounded-lg border border-input p-2">
                {businessUnits.length === 0 ? (
                  <p className="text-xs font-medium text-muted-foreground px-2 py-1">
                    No business units defined. Create one in Settings → Business Units first.
                  </p>
                ) : (
                  businessUnits.map((b) => (
                    <label
                      key={b.id}
                      className="flex items-center gap-2 cursor-pointer rounded-md px-2 py-1.5 hover:bg-accent"
                    >
                      <input
                        type="checkbox"
                        className="size-4 cursor-pointer accent-primary"
                        checked={unitIds.includes(b.id)}
                        onChange={() => toggleUnit(b.id)}
                      />
                      <span className="text-sm font-semibold">{b.name}</span>
                      <span className="text-xs font-mono text-muted-foreground">{b.code}</span>
                    </label>
                  ))
                )}
              </div>
              <p className="text-xs font-medium text-muted-foreground">
                Pick every business line this position applies to. Cross-branch staffing is
                handled by the shift schedule, not this field.
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
