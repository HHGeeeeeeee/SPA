'use client';

import { useTransition } from 'react';
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
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

import { setTransactionCodeActive } from '@/app/(dashboard)/settings/transaction-codes/actions';
import { TransactionCodeFormDialog, type TxCodeItem } from './transaction-code-form-dialog';

interface Props {
  item: TxCodeItem & { active: boolean };
  branches: { id: string; code: string; name: string }[];
  paymentMethods: { id: string; code: string; display_name: string }[];
}

export function TransactionCodeRowActions({ item, branches, paymentMethods }: Props) {
  const [pending, startTransition] = useTransition();

  function toggleActive() {
    startTransition(async () => {
      const r = await setTransactionCodeActive(item.id, !item.active);
      if (r.ok) toast.success(item.active ? 'Deactivated' : 'Reactivated');
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
          <TransactionCodeFormDialog
            mode="edit"
            item={item}
            branches={branches}
            paymentMethods={paymentMethods}
            trigger={
              <DropdownMenuItem onSelect={(e) => e.preventDefault()}>
                <Pencil className="size-4" />
                Edit
              </DropdownMenuItem>
            }
          />
          <DropdownMenuSeparator />
          {item.active ? (
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
                  <AlertDialogTitle>Deactivate transaction code?</AlertDialogTitle>
                  <AlertDialogDescription>
                    <strong>{item.code}</strong> will not be used for future postings. Existing
                    posted entries are unaffected.
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
              Reactivate
            </DropdownMenuItem>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
