'use client';

import { Layers, Plus } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';

import { BusinessUnitFormDialog } from './business-unit-form-dialog';
import { BusinessUnitRowActions } from './business-unit-row-actions';

interface Unit {
  id: string;
  code: string;
  name: string;
  active: boolean;
}

export function BusinessUnitsManagerDialog({ units }: { units: Unit[] }) {
  return (
    <Dialog>
      <DialogTrigger
        render={
          <Button variant="outline">
            <Layers className="size-4" />
            Business Units
          </Button>
        }
      />
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="font-bold">Business Units</DialogTitle>
          <DialogDescription className="font-medium">
            Business lines (SPA, Gym, …) that own services, positions, and resources.
            Assign them to branches via each branch&rsquo;s form.
          </DialogDescription>
        </DialogHeader>

        <div className="rounded-md border overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-32 font-bold">Code</TableHead>
                <TableHead className="font-bold">Name</TableHead>
                <TableHead className="w-28 font-bold">Status</TableHead>
                <TableHead className="w-12" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {units.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={4} className="text-center py-8">
                    <p className="text-sm font-semibold text-muted-foreground">
                      No business units yet.
                    </p>
                  </TableCell>
                </TableRow>
              ) : (
                units.map((u) => (
                  <TableRow key={u.id}>
                    <TableCell className="font-mono font-bold uppercase">{u.code}</TableCell>
                    <TableCell className="font-semibold">{u.name}</TableCell>
                    <TableCell>
                      {u.active ? (
                        <Badge className="font-bold">Active</Badge>
                      ) : (
                        <Badge variant="secondary" className="font-bold">Inactive</Badge>
                      )}
                    </TableCell>
                    <TableCell>
                      <BusinessUnitRowActions item={u} />
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>

        <DialogFooter>
          <BusinessUnitFormDialog
            trigger={
              <Button variant="secondary">
                <Plus className="size-4" />
                Add Business Unit
              </Button>
            }
          />
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
