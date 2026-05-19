import Link from 'next/link';
import { ChevronLeft, Plus } from 'lucide-react';

import { createServiceClient } from '@/lib/supabase/server';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Card } from '@/components/ui/card';
import { BranchFormDialog } from '@/components/settings/branch-form-dialog';
import { BranchRowActions } from '@/components/settings/branch-row-actions';

export const dynamic = 'force-dynamic';

async function fetchBranches() {
  const supabase = createServiceClient();
  const { data, error } = await supabase
    .from('branches')
    .select('id, code, name, active, created_at, updated_at')
    .order('code');
  if (error) throw new Error(error.message);
  return data ?? [];
}

export default async function BranchesPage() {
  const branches = await fetchBranches();
  const activeCount = branches.filter((b) => b.active).length;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <Link
            href="/settings"
            className="inline-flex items-center gap-1 text-xs font-semibold text-muted-foreground hover:text-foreground"
          >
            <ChevronLeft className="size-3" />
            Settings
          </Link>
          <h2 className="text-3xl font-bold tracking-tight mt-1">Branches</h2>
          <p className="text-sm font-semibold text-muted-foreground mt-1">
            {branches.length} total · {activeCount} active
          </p>
        </div>

        <BranchFormDialog
          trigger={
            <Button>
              <Plus className="size-4" />
              Add Branch
            </Button>
          }
        />
      </div>

      <Card className="p-0 overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-32 font-bold">Code</TableHead>
              <TableHead className="font-bold">Name</TableHead>
              <TableHead className="w-32 font-bold">Status</TableHead>
              <TableHead className="w-48 font-bold">Updated</TableHead>
              <TableHead className="w-12" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {branches.length === 0 ? (
              <TableRow>
                <TableCell colSpan={5} className="text-center py-12">
                  <p className="text-sm font-semibold text-muted-foreground">
                    No branches yet. Click &ldquo;Add Branch&rdquo; above to create the
                    first one.
                  </p>
                </TableCell>
              </TableRow>
            ) : (
              branches.map((b) => (
                <TableRow key={b.id}>
                  <TableCell className="font-mono font-bold">{b.code}</TableCell>
                  <TableCell className="font-semibold">{b.name}</TableCell>
                  <TableCell>
                    {b.active ? (
                      <Badge variant="default" className="font-bold">
                        Active
                      </Badge>
                    ) : (
                      <Badge variant="secondary" className="font-bold">
                        Inactive
                      </Badge>
                    )}
                  </TableCell>
                  <TableCell className="font-medium text-muted-foreground text-sm">
                    {new Date(b.updated_at).toLocaleString('en-PH', {
                      dateStyle: 'medium',
                      timeStyle: 'short',
                    })}
                  </TableCell>
                  <TableCell>
                    <BranchRowActions branch={b} />
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </Card>
    </div>
  );
}
