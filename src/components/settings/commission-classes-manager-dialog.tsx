'use client';

import { Briefcase, Plus } from 'lucide-react';

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

import { CommissionClassFormDialog } from './commission-class-form-dialog';
import { CommissionClassRowActions } from './commission-class-row-actions';

interface ClassItem {
  id: string;
  class_code: string;
  name: string;
  commission_rate: number;
  active: boolean;
}

export function CommissionClassesManagerDialog({ items }: { items: ClassItem[] }) {
  return (
    <Dialog>
      <DialogTrigger
        render={
          <Button variant="outline">
            <Briefcase className="size-4" />
            Commission Classes
          </Button>
        }
      />
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="font-bold">Commission Classes</DialogTitle>
          <DialogDescription className="font-medium">
            M / S / J tiers and base rates. Assigned to employees; policies decide when the
            rate applies.
          </DialogDescription>
        </DialogHeader>

        <div className="rounded-md border overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-24 font-bold">Code</TableHead>
                <TableHead className="font-bold">Name</TableHead>
                <TableHead className="w-24 font-bold">Rate</TableHead>
                <TableHead className="w-28 font-bold">Status</TableHead>
                <TableHead className="w-12" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {items.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={5} className="text-center py-8">
                    <p className="text-sm font-semibold text-muted-foreground">
                      No commission classes yet.
                    </p>
                  </TableCell>
                </TableRow>
              ) : (
                items.map((c) => (
                  <TableRow key={c.id}>
                    <TableCell className="font-mono font-bold">{c.class_code}</TableCell>
                    <TableCell className="font-semibold">{c.name}</TableCell>
                    <TableCell className="font-bold tabular">
                      {(c.commission_rate * 100).toFixed(2)}%
                    </TableCell>
                    <TableCell>
                      {c.active ? (
                        <Badge className="font-bold">Active</Badge>
                      ) : (
                        <Badge variant="secondary" className="font-bold">Inactive</Badge>
                      )}
                    </TableCell>
                    <TableCell>
                      <CommissionClassRowActions item={c} />
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>

        <DialogFooter>
          <CommissionClassFormDialog
            trigger={
              <Button variant="secondary">
                <Plus className="size-4" />
                Add Class
              </Button>
            }
          />
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
