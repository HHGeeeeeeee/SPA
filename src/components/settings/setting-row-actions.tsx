'use client';

import { useTransition } from 'react';
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
  AlertDialogTrigger,
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

  function handleDelete() {
    startTransition(async () => {
      const r = await deleteSetting(setting.id);
      if (r.ok) toast.success('Setting deleted');
      else toast.error(r.error);
    });
  }

  return (
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
          <SettingFormDialog
            mode="edit"
            setting={setting}
            branches={branches}
            trigger={
              <DropdownMenuItem onSelect={(e) => e.preventDefault()}>
                <Pencil className="size-4" />
                Edit Value
              </DropdownMenuItem>
            }
          />
          <DropdownMenuSeparator />
          <AlertDialog>
            <AlertDialogTrigger
              nativeButton={false}
              render={
                <DropdownMenuItem variant="destructive" onSelect={(e) => e.preventDefault()}>
                  <Trash2 className="size-4" />
                  Delete
                </DropdownMenuItem>
              }
            />
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
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
