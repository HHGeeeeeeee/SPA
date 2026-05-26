import Link from 'next/link';

import { createServiceClient } from '@/lib/supabase/server';
import { getAllowedBranches } from '@/lib/branch-access';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { cn } from '@/lib/utils';
import { AddWaitlistForm, WaitlistRowActions } from '@/components/waitlist/waitlist-controls';

export const dynamic = 'force-dynamic';

function hm(ts: string): string {
  return new Date(ts).toLocaleTimeString('en-PH', { timeZone: 'Asia/Manila', hour: '2-digit', minute: '2-digit' });
}

export default async function WaitlistPage({
  searchParams,
}: {
  searchParams: Promise<{ branch?: string }>;
}) {
  const sp = await searchParams;
  const supabase = createServiceClient();
  const branches = await getAllowedBranches();
  const list = branches ?? [];
  const branchId = sp.branch && list.some((b) => b.id === sp.branch) ? sp.branch : list[0]?.id;

  let waiting: { id: string; customer_name: string; customer_phone: string | null; pax: number; position: number | null; arrived_at: string }[] = [];
  if (branchId) {
    const { data } = await supabase
      .from('waitlist')
      .select('id, customer_name, customer_phone, pax, position, arrived_at')
      .eq('branch_id', branchId)
      .eq('status', 'waiting')
      .order('position');
    waiting = data ?? [];
  }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h2 className="text-3xl font-bold tracking-tight">Waitlist</h2>
        <p className="text-sm font-semibold text-muted-foreground mt-1">{waiting.length} party(ies) waiting</p>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {list.map((b) => (
          <Link
            key={b.id}
            href={`/waitlist?branch=${b.id}`}
            className={cn(
              'rounded-lg px-3 py-1.5 text-sm font-bold transition-colors',
              b.id === branchId ? 'bg-primary text-primary-foreground shadow-sm' : 'bg-muted text-muted-foreground hover:bg-accent',
            )}
          >
            {b.code}
          </Link>
        ))}
      </div>

      {!branchId ? (
        <Card className="border-dashed bg-muted/30 p-8 text-center text-sm font-semibold text-muted-foreground">Create a branch first.</Card>
      ) : (
        <>
          <AddWaitlistForm branchId={branchId} />
          <Card className="p-0 overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-12 font-bold">#</TableHead>
                  <TableHead className="font-bold">Customer</TableHead>
                  <TableHead className="w-16 font-bold">PAX</TableHead>
                  <TableHead className="w-28 font-bold">Arrived</TableHead>
                  <TableHead className="w-56" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {waiting.length === 0 ? (
                  <TableRow><TableCell colSpan={5} className="text-center py-10 text-sm font-semibold text-muted-foreground">No one waiting.</TableCell></TableRow>
                ) : waiting.map((w) => (
                  <TableRow key={w.id}>
                    <TableCell className="font-bold tabular">{w.position ?? '—'}</TableCell>
                    <TableCell className="font-semibold">{w.customer_name}{w.customer_phone && <span className="ml-2 font-medium text-muted-foreground">{w.customer_phone}</span>}</TableCell>
                    <TableCell className="font-bold tabular">{w.pax}</TableCell>
                    <TableCell className="font-medium tabular text-muted-foreground">{hm(w.arrived_at)}</TableCell>
                    <TableCell><WaitlistRowActions id={w.id} /></TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Card>
        </>
      )}
    </div>
  );
}
