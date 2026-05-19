'use client';

import { useState, useTransition } from 'react';
import { MoreVertical, Pencil, Trash2 } from 'lucide-react';
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

import { deleteSetting } from '@/app/(dashboard)/settings/system/actions';
import { SettingFormDialog, type SettingItem } from './setting-form-dialog';

interface Props {
  setting: SettingItem;
  branches: { id: string; code: string; name: string }[];
}

export function SettingRowActions({ setting, branches }: Props) {
  const [pending, startTransition] = useTransition();
  const [editOpen, setEditOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  function handleDelete() {
    startTransition(async () => {
      const r = await deleteSetting(setting.id);
      if (r.ok) toast.success('Setting deleted');
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
              Edit Value
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              variant="destructive"
              onSelect={() => setTimeout(() => setConfirmDelete(true))}
            >
              <Trash2 className="size-4" />
              Delete
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <SettingFormDialog
        mode="edit"
        setting={setting}
        branches={branches}
        open={editOpen}
        onOpenChange={setEditOpen}
      />

      <AlertDialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this setting?</AlertDialogTitle>
            <AlertDialogDescription>
              <strong>{setting.key}</strong> will be removed and code falls back to its
              hard-coded default. Only delete obsolete keys.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleDelete}>Delete</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
