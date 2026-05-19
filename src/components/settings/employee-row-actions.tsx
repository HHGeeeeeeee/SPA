'use client';

import { useState, useTransition } from 'react';
import { MoreVertical, Pencil, Power, PowerOff, Plane } from 'lucide-react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

import { setEmployeeStatus } from '@/app/(dashboard)/settings/employees/actions';
import { EmployeeFormDialog, type EmployeeItem } from './employee-form-dialog';

interface Props {
  employee: EmployeeItem;
  branches: { id: string; code: string; name: string }[];
  classes: { id: string; class_code: string; name: string }[];
  positions: { id: string; code: string; name: string }[];
}

export function EmployeeRowActions({ employee, branches, classes, positions }: Props) {
  const [pending, startTransition] = useTransition();
  const [editOpen, setEditOpen] = useState(false);

  function setStatus(next: EmployeeItem['status']) {
    startTransition(async () => {
      const r = await setEmployeeStatus(employee.id, next);
      if (r.ok) toast.success(`Status: ${next}`);
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
            {employee.status !== 'active' && (
              <DropdownMenuItem onClick={() => setStatus('active')}>
                <Power className="size-4" />
                Activate
              </DropdownMenuItem>
            )}
            {employee.status !== 'on_leave' && (
              <DropdownMenuItem onClick={() => setStatus('on_leave')}>
                <Plane className="size-4" />
                Mark on leave
              </DropdownMenuItem>
            )}
            {employee.status !== 'inactive' && (
              <DropdownMenuItem variant="destructive" onClick={() => setStatus('inactive')}>
                <PowerOff className="size-4" />
                Deactivate
              </DropdownMenuItem>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <EmployeeFormDialog
        mode="edit"
        employee={employee}
        branches={branches}
        classes={classes}
        positions={positions}
        open={editOpen}
        onOpenChange={setEditOpen}
      />
    </>
  );
}
