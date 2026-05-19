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

import { createBranch, updateBranch } from '@/app/(dashboard)/settings/branches/actions';

interface BranchFormDialogProps {
  mode?: 'create' | 'edit';
  branch?: { id: string; code: string; name: string };
  trigger: React.ReactNode;
}

export function BranchFormDialog({
  mode = 'create',
  branch,
  trigger,
}: BranchFormDialogProps) {
  const [open, setOpen] = useState(false);
  const [code, setCode] = useState(branch?.code ?? '');
  const [name, setName] = useState(branch?.name ?? '');
  const [pending, startTransition] = useTransition();

  const isEdit = mode === 'edit';

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    startTransition(async () => {
      const result = isEdit
        ? await updateBranch({ id: branch!.id, name })
        : await createBranch({ code, name });
      if (result.ok) {
        toast.success(isEdit ? 'Branch updated' : 'Branch created');
        setOpen(false);
        if (!isEdit) {
          setCode('');
          setName('');
        }
      } else {
        toast.error(result.error);
      }
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={trigger as React.ReactElement} />
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
