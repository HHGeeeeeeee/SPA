import { redirect } from 'next/navigation';

import { createServiceClient } from '@/lib/supabase/server';
import { currentSession, isManager } from '@/lib/auth';
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

export const dynamic = 'force-dynamic';

function peso(cents: number): string {
  return (cents / 100).toLocaleString('en-PH', { maximumFractionDigits: 0 });
}

function one<T>(v: T | T[] | null): T | null {
  return Array.isArray(v) ? (v[0] ?? null) : v;
}

function monthRange(): { from: string; to: string; label: string } {
  const now = new Date();
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Manila', year: 'numeric', month: '2-digit' })
    .format(now)
    .split('-');
  const y = Number(parts[0]);
  const m = Number(parts[1]);
  const from = `${y}-${String(m).padStart(2, '0')}-01`;
  const lastDay = new Date(y, m, 0).getDate();
  const to = `${y}-${String(m).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;
  const label = new Date(`${from}T00:00:00`).toLocaleDateString('en-PH', { month: 'long', year: 'numeric' });
  return { from, to, label };
}

async function fetchData() {
  const { from, to, label } = monthRange();
  const supabase = createServiceClient();
  const [ordRes, payRes] = await Promise.all([
    supabase
      .from('orders')
      .select(`
        id, subtotal_cents, discount_cents, total_cents, paid_cents, status,
        branch:branches!orders_branch_id_fkey ( code, name )
      `)
      .gte('service_date', from)
      .lte('service_date', to)
      .not('status', 'in', '("void")')
      .is('deleted_at', null),
    supabase
      .from('folio_lines')
      .select('amount_cents, kind, posted_at, method:payment_methods!folio_lines_payment_method_id_fkey ( code, display_name )')
      .in('kind', ['payment', 'refund'])
      .gte('posted_at', from + 'T00:00:00')
      .lte('posted_at', to + 'T23:59:59'),
  ]);
  if (ordRes.error) throw new Error(ordRes.error.message);
  if (payRes.error) throw new Error(payRes.error.message);
  return { orders: ordRes.data ?? [], payments: payRes.data ?? [], label };
}

export default async function ReportsPage() {
  if (!isManager(await currentSession())) redirect('/dashboard');
  const { orders, payments, label } = await fetchData();

  const gross = orders.reduce((s, o) => s + o.subtotal_cents, 0);
  const discount = orders.reduce((s, o) => s + o.discount_cents, 0);
  const net = orders.reduce((s, o) => s + o.total_cents, 0);
  const collected = orders.reduce((s, o) => s + o.paid_cents, 0);

  const kpis = [
    { label: 'Orders', value: String(orders.length) },
    { label: 'Gross Sales', value: peso(gross) },
    { label: 'Discount', value: peso(discount) },
    { label: 'Net Revenue', value: peso(net) },
    { label: 'Collected', value: peso(collected) },
  ];

  // payment method breakdown
  const byMethod = new Map<string, { name: string; total: number; count: number }>();
  for (const p of payments) {
    const m = one(p.method);
    const key = m?.code ?? 'unknown';
    if (!byMethod.has(key)) byMethod.set(key, { name: m?.display_name ?? key, total: 0, count: 0 });
    const e = byMethod.get(key)!;
    e.total += (p.kind === 'refund' ? -p.amount_cents : p.amount_cents);
    e.count += 1;
  }
  const methodList = [...byMethod.values()].sort((a, b) => b.total - a.total);

  // per-branch
  const byBranch = new Map<string, { code: string; orders: number; net: number }>();
  for (const o of orders) {
    const b = one(o.branch);
    const key = b?.code ?? '—';
    if (!byBranch.has(key)) byBranch.set(key, { code: key, orders: 0, net: 0 });
    const e = byBranch.get(key)!;
    e.orders += 1;
    e.net += o.total_cents;
  }
  const branchList = [...byBranch.values()].sort((a, b) => b.net - a.net);

  return (
    <div className="flex flex-col gap-6">
      <div>
        <div className="flex items-center gap-3">
          <h2 className="text-3xl font-bold tracking-tight">Reports</h2>
          <Badge variant="secondary" className="font-bold">{label}</Badge>
        </div>
        <p className="text-sm font-semibold text-muted-foreground mt-1">
          Current-month summary across all branches
        </p>
      </div>

      <div className="grid grid-cols-2 gap-4 md:grid-cols-5">
        {kpis.map((k) => (
          <Card key={k.label}>
            <CardHeader className="pb-2">
              <CardTitle className="text-xs font-bold text-muted-foreground uppercase tracking-[0.12em]">{k.label}</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-extrabold tracking-tight tabular">{k.value}</div>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <Card className="p-0 overflow-hidden">
          <CardHeader className="border-b border-border py-3"><CardTitle className="text-base font-bold">Collected by Payment Method</CardTitle></CardHeader>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="font-bold">Method</TableHead>
                <TableHead className="w-20 font-bold text-right">Count</TableHead>
                <TableHead className="w-36 font-bold text-right">Total</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {methodList.length === 0 ? (
                <TableRow><TableCell colSpan={3} className="text-center py-8 text-sm font-semibold text-muted-foreground">No payments this month.</TableCell></TableRow>
              ) : methodList.map((m) => (
                <TableRow key={m.name}>
                  <TableCell className="font-semibold">{m.name}</TableCell>
                  <TableCell className="font-bold tabular text-right">{m.count}</TableCell>
                  <TableCell className="font-bold tabular text-right">{peso(m.total)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>

        <Card className="p-0 overflow-hidden">
          <CardHeader className="border-b border-border py-3"><CardTitle className="text-base font-bold">Net Revenue by Branch</CardTitle></CardHeader>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="font-bold">Branch</TableHead>
                <TableHead className="w-20 font-bold text-right">Orders</TableHead>
                <TableHead className="w-36 font-bold text-right">Net</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {branchList.length === 0 ? (
                <TableRow><TableCell colSpan={3} className="text-center py-8 text-sm font-semibold text-muted-foreground">No orders this month.</TableCell></TableRow>
              ) : branchList.map((b) => (
                <TableRow key={b.code}>
                  <TableCell className="font-mono font-bold">{b.code}</TableCell>
                  <TableCell className="font-bold tabular text-right">{b.orders}</TableCell>
                  <TableCell className="font-bold tabular text-right">{peso(b.net)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
      </div>
    </div>
  );
}
