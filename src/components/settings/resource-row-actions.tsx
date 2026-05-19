'use client';

import { useState, useTransition } from 'react';
import { MoreVertical, Pencil, Power, Sparkles, Wrench, Ban } from 'lucide-react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

import { setResourceStatus } from '@/app/(dashboard)/settings/resources/actions';
import { ResourceFormDialog, type ResourceItem } from './resource-form-dialog';

interface Props {
  resource: ResourceItem & { status: 'active' | 'cleaning' | 'maintenance' | 'closed' };
  branches: { id: string; code: string; name: string }[];
}

export function ResourceRowActions({ resource, branches }: Props) {
  const [pending, startTransition] = useTransition();
  const [editOpen, setEditOpen] = useState(false);

  function setStatus(next: 'active' | 'cleaning' | 'maintenance' | 'closed') {
    startTransition(async () => {
      const r = await setResourceStatus(resource.id, next);
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
            <DropdownMenuItem onSelect={() => setEditOpen(true)}>
              <Pencil className="size-4" />
              Edit
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            {resource.status !== 'active' && (
              <DropdownMenuItem onSelect={() => setStatus('active')}>
                <Power className="size-4" />
                Set Active
              </DropdownMenuItem>
            )}
            {resource.status !== 'cleaning' && (
              <DropdownMenuItem onSelect={() => setStatus('cleaning')}>
                <Sparkles className="size-4" />
                Mark Cleaning
              </DropdownMenuItem>
            )}
            {resource.status !== 'maintenance' && (
              <DropdownMenuItem onSelect={() => setStatus('maintenance')}>
                <Wrench className="size-4" />
                Mark Maintenance
              </DropdownMenuItem>
            )}
            {resource.status !== 'closed' && (
              <DropdownMenuItem variant="destructive" onSelect={() => setStatus('closed')}>
                <Ban className="size-4" />
                Mark Closed
              </DropdownMenuItem>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <ResourceFormDialog
        mode="edit"
        resource={resource}
        branches={branches}
        open={editOpen}
        onOpenChange={setEditOpen}
      />
    </>
  );
}
