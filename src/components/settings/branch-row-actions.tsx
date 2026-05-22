'use client';

import { useState, useTransition } from 'react';
import { MoreVertical, Power, PowerOff, Pencil } from 'lucide-react';
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

import { setBranchActive } from '@/app/(dashboard)/settings/branches/actions';
import { BranchFormDialog } from './branch-form-dialog';

interface Props {
  branch: { id: string; code: string; name: string; business_unit_ids: string[]; reservation_enabled: boolean; active: boolean };
  businessUnits: { id: string; code: string; name: string }[];
}

export function BranchRowActions({ branch, businessUnits }: Props) {
  const [pending, startTransition] = useTransition();
  const [editOpen, setEditOpen] = useState(false);
  const [confirmDeactivate, setConfirmDeactivate] = useState(false);

  function toggleActive(next: boolean) {
    startTransition(async () => {
      const result = await setBranchActive(branch.id, next);
      if (result.ok) {
        toast.success(next ? 'Branch reactivated' : 'Branch deactivated');
      } else {
        toast.error(result.error);
      }
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
            {branch.active ? (
              <DropdownMenuItem
                variant="destructive"
                onClick={() => setTimeout(() => setConfirmDeactivate(true))}
              >
                <PowerOff className="size-4" />
                Deactivate
              </DropdownMenuItem>
            ) : (
              <DropdownMenuItem onClick={() => toggleActive(true)}>
                <Power className="size-4" />
                Reactivate
              </DropdownMenuItem>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <BranchFormDialog
        mode="edit"
        branch={{ id: branch.id, code: branch.code, name: branch.name, business_unit_ids: branch.business_unit_ids, reservation_enabled: branch.reservation_enabled }}
        businessUnits={businessUnits}
        open={editOpen}
        onOpenChange={setEditOpen}
      />

      <AlertDialog open={confirmDeactivate} onOpenChange={setConfirmDeactivate}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Deactivate branch?</AlertDialogTitle>
            <AlertDialogDescription>
              Branch <strong>{branch.code}</strong> will be hidden from operations.
              Existing orders &amp; history remain visible. You can reactivate
              anytime.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => toggleActive(false)}>
              Deactivate
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
