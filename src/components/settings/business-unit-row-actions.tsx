'use client';

import { useState, useTransition } from 'react';
import { MoreVertical, Pencil, Power, PowerOff } from 'lucide-react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

import { setBusinessUnitActive } from '@/app/(dashboard)/settings/business-units/actions';
import { BusinessUnitFormDialog, type BusinessUnitItem } from './business-unit-form-dialog';

interface Props {
  item: BusinessUnitItem & { active: boolean };
}

export function BusinessUnitRowActions({ item }: Props) {
  const [pending, startTransition] = useTransition();
  const [editOpen, setEditOpen] = useState(false);
  const [confirmDeactivate, setConfirmDeactivate] = useState(false);

  function toggleActive() {
    startTransition(async () => {
      const r = await setBusinessUnitActive(item.id, !item.active);
      if (r.ok) toast.success(item.active ? 'Deactivated' : 'Reactivated');
      else toast.error(r.error);
    });
  }

  return (
    <>
      <div className="flex justify-end">
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <Button variant="ghost" size="icon" disabled={pending}>
                <MoreVertical className="size-4" />
              </Button>
            }
          />
          <DropdownMenuContent align="end">
            <DropdownMenuItem onClick={() => setTimeout(() => setEditOpen(true))}>
              <Pencil className="size-4" />
              Edit
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            {item.active ? (
              <DropdownMenuItem
                variant="destructive"
                onClick={() => setTimeout(() => setConfirmDeactivate(true))}
              >
                <PowerOff className="size-4" />
                Deactivate
              </DropdownMenuItem>
            ) : (
              <DropdownMenuItem onClick={toggleActive}>
                <Power className="size-4" />
                Reactivate
              </DropdownMenuItem>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <BusinessUnitFormDialog
        mode="edit"
        item={item}
        open={editOpen}
        onOpenChange={setEditOpen}
      />

      <AlertDialog open={confirmDeactivate} onOpenChange={setConfirmDeactivate}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Deactivate business unit?</AlertDialogTitle>
            <AlertDialogDescription>
              <strong>{item.code}</strong> will no longer appear in unit pickers. Existing
              assignments (positions, categories, services, etc.) stay intact.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={toggleActive}>Deactivate</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
