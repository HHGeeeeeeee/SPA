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

async function fetchData() {
  const supabase = createServiceClient();
  const [brRes, buRes, polRes, ccRes, bcrRes] = await Promise.all([
    supabase
      .from('branches')
      .select(`
        id, code, name, active, reservation_enabled, therapist_share_group, commission_policy_id, created_at, updated_at,
        branch_business_units ( business_unit_id, business_units ( id, code, name ) )
      `)
      .order('code'),
    supabase.from('business_units').select('id, code, name').eq('active', true).order('code'),
    supabase.from('commission_policies').select('id, code, name').eq('active', true).order('code'),
    supabase.from('commission_classes').select('id, class_code, name, commission_rate').eq('active', true).order('commission_rate', { ascending: false }),
    supabase.from('branch_commission_rates').select('branch_id, commission_class_id, commission_rate'),
  ]);
  if (brRes.error) throw new Error(brRes.error.message);
  if (buRes.error) throw new Error(buRes.error.message);
  if (polRes.error) throw new Error(polRes.error.message);
  if (ccRes.error) throw new Error(ccRes.error.message);
  if (bcrRes.error) throw new Error(bcrRes.error.message);
  const ratesByBranch = new Map<string, { commission_class_id: string; rate: number }[]>();
  for (const r of bcrRes.data ?? []) {
    const arr = ratesByBranch.get(r.branch_id) ?? [];
    arr.push({ commission_class_id: r.commission_class_id, rate: r.commission_rate });
    ratesByBranch.set(r.branch_id, arr);
  }
  return { branches: brRes.data ?? [], businessUnits: buRes.data ?? [], commissionPolicies: polRes.data ?? [], commissionClasses: ccRes.data ?? [], ratesByBranch };
}

export default async function BranchesPage() {
  const { branches, businessUnits, commissionPolicies, commissionClasses, ratesByBranch } = await fetchData();
  const activeCount = branches.filter((b) => b.active).length;
  // Distinct therapist-sharing labels in use → autocomplete for the branch form.
  const shareGroupSuggestions = [...new Set(branches.map((b) => b.therapist_share_group).filter(Boolean) as string[])].sort();

  return (
    <div className="flex flex-col gap-6 max-w-6xl">
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
          businessUnits={businessUnits}
          commissionPolicies={commissionPolicies}
          commissionClasses={commissionClasses}
          shareGroupSuggestions={shareGroupSuggestions}
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
              <TableHead className="w-72 font-bold">Name</TableHead>
              <TableHead className="font-bold whitespace-nowrap">Business Unit</TableHead>
              <TableHead className="font-bold whitespace-nowrap">Sharing Group</TableHead>
              <TableHead className="w-28 font-bold">Reservations</TableHead>
              <TableHead className="w-32 font-bold">Status</TableHead>
              <TableHead className="w-48 font-bold">Updated</TableHead>
              <TableHead className="w-12" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {branches.length === 0 ? (
              <TableRow>
                <TableCell colSpan={8} className="text-center py-12">
                  <p className="text-sm font-semibold text-muted-foreground">
                    No branches yet. Click &ldquo;Add Branch&rdquo; above to create the
                    first one.
                  </p>
                </TableCell>
              </TableRow>
            ) : (
              branches.map((b) => {
                const units = (b.branch_business_units ?? [])
                  .map((row) => (Array.isArray(row.business_units) ? row.business_units[0] : row.business_units))
                  .filter(Boolean) as { id: string; code: string; name: string }[];
                const branchItem = {
                  id: b.id,
                  code: b.code,
                  name: b.name,
                  business_unit_ids: units.map((u) => u.id),
                  reservation_enabled: b.reservation_enabled,
                  therapist_share_group: b.therapist_share_group,
                  commission_policy_id: b.commission_policy_id,
                  commission_rate_overrides: ratesByBranch.get(b.id) ?? [],
                  active: b.active,
                };
                return (
                  <TableRow key={b.id}>
                    <TableCell className="font-mono font-bold">{b.code}</TableCell>
                    <TableCell className="font-semibold">{b.name}</TableCell>
                    <TableCell>
                      <div className="flex items-center gap-1">
                        {units.length === 0 ? (
                          <span className="text-muted-foreground text-sm">—</span>
                        ) : (
                          units.map((u) => (
                            <Badge key={u.id} variant="secondary" className="font-bold text-xs shrink-0 whitespace-nowrap">
                              {u.name}
                            </Badge>
                          ))
                        )}
                      </div>
                    </TableCell>
                    <TableCell>
                      {b.therapist_share_group ? (
                        <Badge variant="outline" className="font-bold text-xs whitespace-nowrap">
                          {b.therapist_share_group}
                        </Badge>
                      ) : (
                        <span className="text-muted-foreground text-sm">—</span>
                      )}
                    </TableCell>
                    <TableCell>
                      {b.reservation_enabled ? (
                        <Badge variant="default" className="font-bold">On</Badge>
                      ) : (
                        <span className="text-xs font-semibold text-muted-foreground">Off</span>
                      )}
                    </TableCell>
                    <TableCell>
                      {b.active ? (
                        <Badge variant="default" className="font-bold">Active</Badge>
                      ) : (
                        <Badge variant="secondary" className="font-bold">Inactive</Badge>
                      )}
                    </TableCell>
                    <TableCell className="font-medium text-muted-foreground text-sm">
                      {new Date(b.updated_at).toLocaleString('en-PH', {
                        dateStyle: 'medium',
                        timeStyle: 'short',
                      })}
                    </TableCell>
                    <TableCell>
                      <BranchRowActions branch={branchItem} businessUnits={businessUnits} commissionPolicies={commissionPolicies} commissionClasses={commissionClasses} shareGroupSuggestions={shareGroupSuggestions} />
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
