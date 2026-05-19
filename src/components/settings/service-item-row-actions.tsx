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

import { setServiceItemActive } from '@/app/(dashboard)/settings/service-items/actions';
import { ServiceItemFormDialog, type ServiceItemRecord } from './service-item-form-dialog';

interface Props {
  item: ServiceItemRecord & { active: boolean };
  categories: { id: string; code: string; name: string }[];
}

export function ServiceItemRowActions({ item, categories }: Props) {
  const [pending, startTransition] = useTransition();

  function toggleActive() {
    startTransition(async () => {
      const r = await setServiceItemActive(item.id, !item.active);
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
          <ServiceItemFormDialog
            mode="edit"
            item={item}
            categories={categories}
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
                render={
                  <DropdownMenuItem variant="destructive" onSelect={(e) => e.preventDefault()}>
                    <PowerOff className="size-4" />
                    Deactivate
                  </DropdownMenuItem>
                }
              />
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Deactivate service?</AlertDialogTitle>
                  <AlertDialogDescription>
                    <strong>{item.code} — {item.name}</strong> will not be selectable on new
                    orders. Existing orders are unaffected.
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
