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

import { setServiceCategoryActive } from '@/app/(dashboard)/settings/service-categories/actions';
import {
  ServiceCategoryFormDialog,
  type CategoryItem,
} from './service-category-form-dialog';

interface Props {
  item: CategoryItem & { active: boolean };
}

export function ServiceCategoryRowActions({ item }: Props) {
  const [pending, startTransition] = useTransition();
  const [editOpen, setEditOpen] = useState(false);
  const [confirmDeactivate, setConfirmDeactivate] = useState(false);

  function toggleActive() {
    startTransition(async () => {
      const r = await setServiceCategoryActive(item.id, !item.active);
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
            <DropdownMenuItem onSelect={() => setTimeout(() => setEditOpen(true))}>
              <Pencil className="size-4" />
              Edit
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            {item.active ? (
              <DropdownMenuItem
                variant="destructive"
                onSelect={() => setTimeout(() => setConfirmDeactivate(true))}
              >
                <PowerOff className="size-4" />
                Deactivate
              </DropdownMenuItem>
            ) : (
              <DropdownMenuItem onSelect={toggleActive}>
                <Power className="size-4" />
                Reactivate
              </DropdownMenuItem>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <ServiceCategoryFormDialog
        mode="edit"
        item={item}
        open={editOpen}
        onOpenChange={setEditOpen}
      />

      <AlertDialog open={confirmDeactivate} onOpenChange={setConfirmDeactivate}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Deactivate category?</AlertDialogTitle>
            <AlertDialogDescription>
              <strong>{item.code}</strong> will not appear when creating new Service Items.
              Existing items are unaffected.
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
