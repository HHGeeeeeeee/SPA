'use client';

import { useState, useTransition } from 'react';
import { MoreVertical, Pencil, Power, PowerOff, KeyRound, Trash2 } from 'lucide-react';
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

import {
  clearManagerPin,
  setStaffUserActive,
} from '@/app/(dashboard)/settings/users/actions';
import { UserFormDialog, type StaffUserItem } from './user-form-dialog';
import { UserPinDialog } from './user-pin-dialog';

interface Props {
  user: StaffUserItem & { has_pin: boolean };
  branches: { id: string; code: string; name: string }[];
}

export function UserRowActions({ user, branches }: Props) {
  const [pending, startTransition] = useTransition();
  const [editOpen, setEditOpen] = useState(false);
  const [pinOpen, setPinOpen] = useState(false);
  const [confirmDeactivate, setConfirmDeactivate] = useState(false);

  function toggleActive() {
    startTransition(async () => {
      const r = await setStaffUserActive(user.id, !user.active);
      if (r.ok) toast.success(user.active ? 'Deactivated' : 'Reactivated');
      else toast.error(r.error);
    });
  }

  function handleClearPin() {
    startTransition(async () => {
      const r = await clearManagerPin(user.id);
      if (r.ok) toast.success('Manager PIN cleared');
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
            <DropdownMenuItem onSelect={() => setEditOpen(true)}>
              <Pencil className="size-4" />
              Edit
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => setPinOpen(true)}>
              <KeyRound className="size-4" />
              {user.has_pin ? 'Reset Manager PIN' : 'Set Manager PIN'}
            </DropdownMenuItem>
            {user.has_pin && (
              <DropdownMenuItem onSelect={handleClearPin}>
                <Trash2 className="size-4" />
                Clear Manager PIN
              </DropdownMenuItem>
            )}
            <DropdownMenuSeparator />
            {user.active ? (
              <DropdownMenuItem
                variant="destructive"
                onSelect={() => setConfirmDeactivate(true)}
              >
                <PowerOff className="size-4" />
                Deactivate
              </DropdownMenuItem>
            ) : (
              <DropdownMenuItem onSelect={toggleActive}>
                <Power className="size-4" />
                Activate
              </DropdownMenuItem>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <UserFormDialog
        mode="edit"
        user={user}
        branches={branches}
        open={editOpen}
        onOpenChange={setEditOpen}
      />

      <UserPinDialog
        userId={user.id}
        username={user.acumatica_user_id}
        open={pinOpen}
        onOpenChange={setPinOpen}
      />

      <AlertDialog open={confirmDeactivate} onOpenChange={setConfirmDeactivate}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Deactivate user?</AlertDialogTitle>
            <AlertDialogDescription>
              <strong>{user.acumatica_user_id}</strong> will not be able to log in until
              reactivated. Past activity stays intact.
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
