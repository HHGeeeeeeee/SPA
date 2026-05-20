import Link from 'next/link';
import { ChevronLeft, Plus, Coins } from 'lucide-react';

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
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { TipSettlementDialog } from '@/components/reconciliation/tip-settlement-dialog';
import { TipSettlementActions } from '@/components/reconciliation/tip-settlement-actions';

export const dynamic = 'force-dynamic';

function peso(cents: number): string {
  return `₱${(cents / 100).toLocaleString('en-PH', { minimumFractionDigits: 2 })}`;
}
function one<T>(v: T | T[] | null): T | null {
  return Array.isArray(v) ? (v[0] ?? null) : v;
}

const STATUS_VARIANT: Record<string, 'default' | 'secondary' | 'destructive'> = {
  draft: 'secondary', closed: 'default', void: 'destructive',
};

interface TipRow { amount_cents: number; therapist: string; settlement_id: string | null; status: string; service_date: string }

async function fetchData() {
  const supabase = createServiceClient();
  const [setRes, tipRes] = await Promise.all([
    supabase.from('tip_settlements').select('id, settlement_no, period_from, period_to, status, subtotal_cents').order('period_from', { ascending: false }),
    supabase
      .from('tips')
      .select('amount_cents, settlement_id, status, therapist:employees!tips_therapist_id_fkey ( name ), order:orders!tips_order_id_fkey ( service_date )'),
  ]);
  const tips: TipRow[] = (tipRes.data ?? []).map((t) => ({
    amount_cents: t.amount_cents,
    therapist: one(t.therapist)?.name ?? '—',
    settlement_id: t.settlement_id,
    status: t.status,
    service_date: one(t.order)?.service_date ?? '',
  }));
  return { settlements: setRes.data ?? [], tips };
}

function groupByTherapist(rows: TipRow[]): { therapist: string; count: number; total: number }[] {
  const m = new Map<string, { count: number; total: number }>();
  for (const r of rows) {
    const g = m.get(r.therapist) ?? { count: 0, total: 0 };
    g.count += 1;
    g.total += r.amount_cents;
    m.set(r.therapist, g);
  }
  return [...m.entries()].map(([therapist, g]) => ({ therapist, ...g })).sort((a, b) => b.total - a.total);
}

export default async function TipSettlementPage() {
  const { settlements, tips } = await fetchData();
  const openTips = tips.filter((t) => t.settlement_id == null && t.status === 'open');
  const openTotal = openTips.reduce((s, t) => s + t.amount_cents, 0);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <Link href="/dashboard" className="inline-flex items-center gap-1 text-xs font-semibold text-muted-foreground hover:text-foreground">
            <ChevronLeft className="size-3" /> Reconciliation
          </Link>
          <h2 className="text-3xl font-bold tracking-tight mt-1">Tip Settlement</h2>
          <p className="text-sm font-semibold text-muted-foreground mt-1">
            PAYMAYA tips → settled to AP semi-monthly · {openTips.length} open · {peso(openTotal)}
          </p>
        </div>
        <TipSettlementDialog trigger={<Button><Plus className="size-4" /> New Settlement</Button>} />
      </div>

      {settlements.length === 0 ? (
        <Card className="border-dashed bg-muted/30">
          <CardContent className="py-10 text-center">
            <Coins className="size-8 mx-auto text-muted-foreground/50" />
            <p className="text-sm font-semibold text-muted-foreground mt-3">
              No tip settlements yet. Create one to close out open PAYMAYA tips for a period.
            </p>
          </CardContent>
        </Card>
      ) : (
        settlements.map((s) => {
          const rows = s.status === 'closed' || s.status === 'void'
            ? tips.filter((t) => t.settlement_id === s.id)
            : tips.filter((t) => t.settlement_id == null && t.status === 'open' && t.service_date >= s.period_from && t.service_date <= s.period_to);
          const groups = groupByTherapist(rows);
          return (
            <Card key={s.id} className="p-0 overflow-hidden">
              <CardHeader className="flex-row items-center justify-between border-b border-border py-3">
                <CardTitle className="text-base font-bold flex items-center gap-2">
                  <span className="font-mono">{s.settlement_no}</span>
                  <span className="font-medium text-muted-foreground text-sm">{s.period_from} → {s.period_to}</span>
                  <Badge variant={STATUS_VARIANT[s.status] ?? 'secondary'} className="font-bold capitalize">{s.status}</Badge>
                </CardTitle>
                <div className="flex items-center gap-4">
                  <span className="text-sm font-bold tabular">{peso(s.subtotal_cents)}</span>
                  <TipSettlementActions id={s.id} status={s.status} />
                </div>
              </CardHeader>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="font-bold">Therapist</TableHead>
                    <TableHead className="w-24 font-bold text-right">Tips</TableHead>
                    <TableHead className="w-40 font-bold text-right">Amount</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {groups.length === 0 ? (
                    <TableRow><TableCell colSpan={3} className="text-center py-6 text-sm font-semibold text-muted-foreground">No tips</TableCell></TableRow>
                  ) : groups.map((g) => (
                    <TableRow key={g.therapist}>
                      <TableCell className="font-semibold">{g.therapist}</TableCell>
                      <TableCell className="font-bold tabular text-right">{g.count}</TableCell>
                      <TableCell className="font-bold tabular text-right">{peso(g.total)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </Card>
          );
        })
      )}
    </div>
  );
}
