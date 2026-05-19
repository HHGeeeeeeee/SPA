'use client';

import { useTransition } from 'react';
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
  AlertDialogTrigger,
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
          <UserFormDialog
            mode="edit"
            user={user}
            branches={branches}
            trigger={
              <DropdownMenuItem onSelect={(e) => e.preventDefault()}>
                <Pencil className="size-4" />
                Edit
              </DropdownMenuItem>
            }
          />
          <UserPinDialog
            userId={user.id}
            username={user.acumatica_user_id}
            trigger={
              <DropdownMenuItem onSelect={(e) => e.preventDefault()}>
                <KeyRound className="size-4" />
                {user.has_pin ? 'Reset Manager PIN' : 'Set Manager PIN'}
              </DropdownMenuItem>
            }
          />
          {user.has_pin && (
            <DropdownMenuItem onSelect={handleClearPin}>
              <Trash2 className="size-4" />
              Clear Manager PIN
            </DropdownMenuItem>
          )}
          <DropdownMenuSeparator />
          {user.active ? (
            <AlertDialog>
              <AlertDialogTrigger
                nativeButton={false}
                render={
                  <DropdownMenuItem variant="destructive" onSelect={(e) => e.preventDefault()}>
                    <PowerOff className="size-4" />
                    Deactivate
                  </DropdownMenuItem>
                }
              />
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
          ) : (
            <DropdownMenuItem onSelect={toggleActive}>
              <Power className="size-4" />
              Activate
            </DropdownMenuItem>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
