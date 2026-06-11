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
import { CommissionPolicyFormDialog, type CommissionPolicyItem } from '@/components/settings/commission-policy-form-dialog';
import { CommissionPolicyRowActions } from '@/components/settings/commission-policy-row-actions';

export const dynamic = 'force-dynamic';

async function fetchData() {
  const supabase = createServiceClient();
  const [polRes, brRes] = await Promise.all([
    supabase
      .from('commission_policies')
      .select('id, code, name, kind, free_duration_minutes, warmup_enabled, warmup_occurrence, active, commission_policy_bands ( min_minutes, up_to_minutes, commission_rate, sort_order )')
      .order('code'),
    supabase.from('branches').select('code, commission_policy_id').eq('active', true),
  ]);
  if (polRes.error) throw new Error(polRes.error.message);
  if (brRes.error) throw new Error(brRes.error.message);
  const branchesByPolicy = new Map<string, string[]>();
  for (const b of brRes.data ?? []) {
    if (!b.commission_policy_id) continue;
    (branchesByPolicy.get(b.commission_policy_id) ?? branchesByPolicy.set(b.commission_policy_id, []).get(b.commission_policy_id)!).push(b.code);
  }
  return { policies: polRes.data ?? [], branchesByPolicy };
}

function bandsSummary(bands: { min_minutes: number | null; up_to_minutes: number | null; commission_rate: number; sort_order: number }[]): string {
  const range = (b: { min_minutes: number | null; up_to_minutes: number | null }) => {
    if (b.min_minutes != null && b.up_to_minutes != null) return b.min_minutes === b.up_to_minutes ? `${b.up_to_minutes}m` : `${b.min_minutes}–${b.up_to_minutes}m`;
    if (b.up_to_minutes != null) return `≤${b.up_to_minutes}m`;
    if (b.min_minutes != null) return `≥${b.min_minutes}m`;
    return 'any';
  };
  return [...bands]
    .sort((a, b) => a.sort_order - b.sort_order)
    .map((b) => `${range(b)} → ${Math.round(b.commission_rate * 100)}%`)
    .join(' · ');
}

export default async function CommissionPoliciesPage() {
  const { policies, branchesByPolicy } = await fetchData();

  return (
    <div className="flex flex-col gap-6 max-w-5xl">
      <div className="flex items-start justify-between gap-4">
        <div>
          <Link href="/settings" className="inline-flex items-center gap-1 text-xs font-semibold text-muted-foreground hover:text-foreground">
            <ChevronLeft className="size-3" /> Settings
          </Link>
          <h2 className="text-3xl font-bold tracking-tight mt-1">Commission Policies</h2>
          <p className="text-sm font-semibold text-muted-foreground mt-1">
            {policies.length} total · first-session warm-up rule, assigned per branch
          </p>
        </div>
        <CommissionPolicyFormDialog trigger={<Button><Plus className="size-4" /> Add Policy</Button>} />
      </div>

      <Card className="p-0 overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="font-bold">Code</TableHead>
              <TableHead className="font-bold">Name</TableHead>
              <TableHead className="font-bold">Warm-up</TableHead>
              <TableHead className="font-bold">Used by</TableHead>
              <TableHead className="w-24 font-bold">Status</TableHead>
              <TableHead className="w-12" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {policies.length === 0 ? (
              <TableRow><TableCell colSpan={6} className="text-center py-12 text-sm font-semibold text-muted-foreground">No policies yet.</TableCell></TableRow>
            ) : (
              policies.map((p) => {
                const bands = p.commission_policy_bands ?? [];
                const kind = (p.kind === 'cheapest_free' ? 'cheapest_free' : 'warmup') as CommissionPolicyItem['kind'];
                const item: CommissionPolicyItem = {
                  id: p.id, code: p.code, name: p.name, kind, free_duration_minutes: p.free_duration_minutes,
                  warmup_enabled: p.warmup_enabled, warmup_occurrence: p.warmup_occurrence,
                  bands: bands.map((b) => ({ min_minutes: b.min_minutes, up_to_minutes: b.up_to_minutes, commission_rate: b.commission_rate })),
                };
                const usedBy = branchesByPolicy.get(p.id) ?? [];
                return (
                  <TableRow key={p.id}>
                    <TableCell className="font-mono font-bold">{p.code}</TableCell>
                    <TableCell className="font-semibold">{p.name}</TableCell>
                    <TableCell className="font-medium text-sm">
                      {kind === 'cheapest_free'
                        ? <span>Cheapest <span className="text-muted-foreground">{p.free_duration_minutes != null ? `${p.free_duration_minutes}m` : 'any'} → 0%</span></span>
                        : p.warmup_enabled
                          ? <span>#{p.warmup_occurrence} · <span className="text-muted-foreground">{bandsSummary(bands)}</span></span>
                          : <span className="text-muted-foreground">Off (full rate)</span>}
                    </TableCell>
                    <TableCell className="font-mono font-semibold text-xs">{usedBy.length ? usedBy.join(', ') : <span className="text-muted-foreground">—</span>}</TableCell>
                    <TableCell>{p.active ? <Badge className="font-bold">Active</Badge> : <Badge variant="secondary" className="font-bold">Inactive</Badge>}</TableCell>
                    <TableCell><CommissionPolicyRowActions item={{ ...item, active: p.active }} /></TableCell>
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
