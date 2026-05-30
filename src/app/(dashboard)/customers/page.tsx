import { redirect } from 'next/navigation';
import { Plus, Users } from 'lucide-react';

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
import { CustomerFormDialog, type CustomerItem } from '@/components/customers/customer-form-dialog';
import { CustomerRowActions } from '@/components/customers/customer-row-actions';
import { getAllowedBranches, getAllowedBranchIds } from '@/lib/branch-access';
import { currentSession, isAdmin, isManager } from '@/lib/auth';

export const dynamic = 'force-dynamic';

async function fetchData() {
  const supabase = createServiceClient();
  const viewerIsAdmin = isAdmin(await currentSession());
  const allowedIds = await getAllowedBranchIds();
  // Hard branch scope (per the customer schema migration): non-admin viewers
  // only see customers whose home_branch_id is in their allowed set. Admin
  // sees everyone, including legacy NULL-home rows that the migration
  // couldn't backfill from stored-value cards.
  let query = supabase
    .from('customers')
    .select(`
      id, phone, name, gender, email, dob, customer_type,
      primary_business_unit_id, home_branch_id, status,
      business_unit:business_units ( code ),
      home_branch:branches!customers_home_branch_id_fkey ( code )
    `)
    .is('deleted_at', null)
    .order('name');
  if (!viewerIsAdmin) {
    query = query.in('home_branch_id', [...allowedIds]);
  }
  const [cs, bu, br] = await Promise.all([
    query,
    supabase.from('business_units').select('id, code, name').eq('active', true).order('code'),
    getAllowedBranches(),
  ]);
  if (cs.error) throw new Error(cs.error.message);
  if (bu.error) throw new Error(bu.error.message);
  return { customers: cs.data ?? [], businessUnits: bu.data ?? [], branches: br ?? [] };
}

function one<T>(v: T | T[] | null): T | null {
  return Array.isArray(v) ? (v[0] ?? null) : v;
}

export default async function CustomersPage() {
  if (!isManager(await currentSession())) redirect('/dashboard');
  const { customers, businessUnits, branches } = await fetchData();
  const activeCount = customers.filter((c) => c.status === 'active').length;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-3xl font-bold tracking-tight">Customers</h2>
          <p className="text-sm font-semibold text-muted-foreground mt-1">
            {customers.length} total · {activeCount} active · Repeat guests, SVC holders, members
          </p>
        </div>
        <CustomerFormDialog
          businessUnits={businessUnits}
          branches={branches}
          trigger={
            <Button>
              <Plus className="size-4" />
              New Customer
            </Button>
          }
        />
      </div>

      <Card className="p-0 overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="font-bold">Name</TableHead>
              <TableHead className="w-40 font-bold">Phone</TableHead>
              <TableHead className="w-20 font-bold">Gender</TableHead>
              <TableHead className="font-bold">Type</TableHead>
              <TableHead className="w-24 font-bold">Branch</TableHead>
              <TableHead className="w-24 font-bold">Unit</TableHead>
              <TableHead className="w-24 font-bold">Status</TableHead>
              <TableHead className="w-12" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {customers.length === 0 ? (
              <TableRow>
                <TableCell colSpan={8} className="text-center py-16">
                  <Users className="size-8 mx-auto text-muted-foreground/50" />
                  <p className="text-sm font-semibold text-muted-foreground mt-3">
                    No customers yet. Walk-ins are captured inline on orders — add a master
                    record here for repeat guests or cardholders.
                  </p>
                </TableCell>
              </TableRow>
            ) : (
              customers.map((c) => {
                const bu = one(c.business_unit);
                const hb = one(c.home_branch);
                const record: CustomerItem = {
                  id: c.id,
                  phone: c.phone,
                  name: c.name,
                  home_branch_id: c.home_branch_id,
                  gender: c.gender,
                  email: c.email,
                  dob: c.dob,
                  customer_type: c.customer_type,
                  primary_business_unit_id: c.primary_business_unit_id,
                };
                return (
                  <TableRow key={c.id}>
                    <TableCell className="font-semibold">{c.name}</TableCell>
                    <TableCell className="font-mono font-medium tabular">{c.phone}</TableCell>
                    <TableCell className="font-medium text-muted-foreground">{c.gender ?? '—'}</TableCell>
                    <TableCell className="font-medium">{c.customer_type ?? <span className="text-muted-foreground">—</span>}</TableCell>
                    <TableCell>
                      {hb ? (
                        <Badge variant="secondary" className="font-bold font-mono text-xs uppercase">{hb.code}</Badge>
                      ) : (
                        <span className="text-muted-foreground text-sm">—</span>
                      )}
                    </TableCell>
                    <TableCell>
                      {bu ? (
                        <Badge variant="secondary" className="font-bold font-mono text-xs uppercase">{bu.code}</Badge>
                      ) : (
                        <span className="text-muted-foreground text-sm">—</span>
                      )}
                    </TableCell>
                    <TableCell>
                      {c.status === 'active' ? (
                        <Badge className="font-bold">Active</Badge>
                      ) : (
                        <Badge variant="secondary" className="font-bold">Inactive</Badge>
                      )}
                    </TableCell>
                    <TableCell>
                      <CustomerRowActions customer={{ ...record, status: c.status }} businessUnits={businessUnits} branches={branches} />
                    </TableCell>
                  </TableRow>
                );
              })
            )}
          </TableBody>
        </Table>
      </Card>
    </div>
  );
}
