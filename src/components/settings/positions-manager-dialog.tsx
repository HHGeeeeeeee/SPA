'use client';

import { BadgeCheck, Plus } from 'lucide-react';

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

import { PositionFormDialog } from './position-form-dialog';
import { PositionRowActions } from './position-row-actions';

interface PositionItem {
  id: string;
  code: string;
  name: string;
  active: boolean;
  business_unit_ids: string[];
  units: { id: string; code: string }[];
}

interface Props {
  items: PositionItem[];
  businessUnits: { id: string; code: string; name: string }[];
}

export function PositionsManagerDialog({ items, businessUnits }: Props) {
  return (
    <Dialog>
      <DialogTrigger
        render={
          <Button variant="outline">
            <BadgeCheck className="size-4" />
            Positions
          </Button>
        }
      />
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle className="font-bold">Positions</DialogTitle>
          <DialogDescription className="font-medium">
            HR job titles (Massage Therapist, Hair Stylist, …) assigned to employees.
          </DialogDescription>
        </DialogHeader>

        <div className="rounded-md border overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-28 font-bold">Code</TableHead>
                <TableHead className="font-bold">Name</TableHead>
                <TableHead className="font-bold">Business Units</TableHead>
                <TableHead className="w-28 font-bold">Status</TableHead>
                <TableHead className="w-12" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {items.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={5} className="text-center py-8">
                    <p className="text-sm font-semibold text-muted-foreground">
                      No positions yet.
                    </p>
                  </TableCell>
                </TableRow>
              ) : (
                items.map((p) => (
                  <TableRow key={p.id}>
                    <TableCell className="font-mono font-bold">{p.code}</TableCell>
                    <TableCell className="font-semibold">{p.name}</TableCell>
                    <TableCell>
                      <div className="flex flex-wrap gap-1">
                        {p.units.length === 0 ? (
                          <span className="text-muted-foreground text-sm">—</span>
                        ) : (
                          p.units.map((u) => (
                            <Badge key={u.id} variant="secondary" className="font-bold font-mono text-xs uppercase">
                              {u.code}
                            </Badge>
                          ))
                        )}
                      </div>
                    </TableCell>
                    <TableCell>
                      {p.active ? (
                        <Badge className="font-bold">Active</Badge>
                      ) : (
                        <Badge variant="secondary" className="font-bold">Inactive</Badge>
                      )}
                    </TableCell>
                    <TableCell>
                      <PositionRowActions item={p} businessUnits={businessUnits} />
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>

        <DialogFooter>
          <PositionFormDialog
            businessUnits={businessUnits}
            trigger={
              <Button variant="secondary">
                <Plus className="size-4" />
                Add Position
              </Button>
            }
          />
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
