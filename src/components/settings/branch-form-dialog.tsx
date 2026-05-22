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
import { Switch } from '@/components/ui/switch';

import { createBranch, updateBranch } from '@/app/(dashboard)/settings/branches/actions';

interface BranchFormDialogProps {
  mode?: 'create' | 'edit';
  branch?: { id: string; code: string; name: string; business_unit_ids: string[]; reservation_enabled?: boolean };
  businessUnits: { id: string; code: string; name: string }[];
  trigger?: React.ReactNode;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}

export function BranchFormDialog({
  mode = 'create',
  branch,
  businessUnits,
  trigger,
  open: controlledOpen,
  onOpenChange: controlledOnOpenChange,
}: BranchFormDialogProps) {
  const [internalOpen, setInternalOpen] = useState(false);
  const open = controlledOpen ?? internalOpen;
  const setOpen = controlledOnOpenChange ?? setInternalOpen;
  const [code, setCode] = useState(branch?.code ?? '');
  const [name, setName] = useState(branch?.name ?? '');
  const [unitIds, setUnitIds] = useState<string[]>(branch?.business_unit_ids ?? []);
  const [reservationEnabled, setReservationEnabled] = useState(branch?.reservation_enabled ?? true);
  const [pending, startTransition] = useTransition();

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
      const result = isEdit
        ? await updateBranch({ id: branch!.id, name, business_unit_ids: unitIds, reservation_enabled: reservationEnabled })
        : await createBranch({ code, name, business_unit_ids: unitIds, reservation_enabled: reservationEnabled });
      if (result.ok) {
        toast.success(isEdit ? 'Branch updated' : 'Branch created');
        setOpen(false);
        if (!isEdit) {
          setCode('');
          setName('');
          setUnitIds([]);
        }
      } else {
        toast.error(result.error);
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
              {isEdit ? `Edit Branch: ${branch?.code}` : 'New Branch'}
            </DialogTitle>
            <DialogDescription className="font-medium">
              {isEdit
                ? 'Branch code is immutable. Other fields can be updated.'
                : 'Create a new branch / location.'}
            </DialogDescription>
          </DialogHeader>

          <div className="flex flex-col gap-4 py-4">
            <div className="flex flex-col gap-2">
              <Label htmlFor="branch-code" className="font-semibold">
                Code *
              </Label>
              <Input
                id="branch-code"
                value={code}
                onChange={(e) => setCode(e.target.value.toUpperCase())}
                placeholder="OSP1"
                disabled={isEdit}
                required
                pattern="[A-Z0-9_-]+"
                maxLength={20}
              />
              <p className="text-xs font-medium text-muted-foreground">
                Uppercase letters, digits, - and _ only. Cannot be changed later.
              </p>
            </div>

            <div className="flex flex-col gap-2">
              <Label htmlFor="branch-name" className="font-semibold">
                Display Name *
              </Label>
              <Input
                id="branch-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Oriental SPA 1"
                required
                maxLength={120}
              />
            </div>

            <div className="flex flex-col gap-2">
              <Label className="font-semibold">Business Units *</Label>
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
                Which business lines operate at this branch. A single location can host
                more than one (e.g. SPA + Gym).
              </p>
            </div>

            <div className="flex items-center justify-between rounded-lg border border-border px-3 py-2">
              <div>
                <Label className="font-semibold cursor-pointer">Accepts reservations</Label>
                <p className="text-xs font-medium text-muted-foreground">
                  When off, this branch is hidden from the New Reservation picker.
                </p>
              </div>
              <Switch checked={reservationEnabled} onCheckedChange={setReservationEnabled} />
            </div>
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="ghost"
              onClick={() => setOpen(false)}
              disabled={pending}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={pending}>
              {pending ? 'Saving…' : isEdit ? 'Save changes' : 'Create branch'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
