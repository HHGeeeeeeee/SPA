import { Card, CardContent, CardHeader } from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';

export interface CommRow {
  therapistId: string;
  name: string;
  sessions: number;
  minutes: number;
  grossCents: number;
  commissionCents: number;
  borrowedFrom: string | null;
}

function peso(cents: number): string {
  return (cents / 100).toLocaleString('en-PH', { minimumFractionDigits: 0 });
}

// Top-10 therapists by today's simulated commission. Commission reuses the
// settlement engine, so it only reflects orders already CLOSED today.
export function DashboardCommission({ rows }: { rows: CommRow[] }) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <h3 className="text-sm font-bold text-muted-foreground uppercase tracking-[0.12em]">Top therapists by commission · Today</h3>
        <p className="text-[11px] font-medium text-muted-foreground">Simulated on orders already closed today (settlement basis).</p>
      </CardHeader>
      <CardContent>
        {rows.length === 0 ? (
          <p className="py-4 text-sm font-medium text-muted-foreground">No commission earned yet today.</p>
        ) : (
          <div className="overflow-x-auto rounded-lg border border-border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-10 text-center">#</TableHead>
                  <TableHead>Therapist</TableHead>
                  <TableHead className="text-right">Net</TableHead>
                  <TableHead className="text-right">Commission</TableHead>
                  <TableHead className="text-right">Sessions</TableHead>
                  <TableHead className="text-right">Hour Completed</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((r, i) => (
                  <TableRow key={r.therapistId}>
                    <TableCell className="text-center font-bold tabular-nums text-muted-foreground">{i + 1}</TableCell>
                    <TableCell className="font-semibold">
                      {r.name}
                      {r.borrowedFrom && <span className="ml-1.5 rounded bg-muted px-1 text-[10px] font-bold uppercase text-muted-foreground">{r.borrowedFrom}</span>}
                    </TableCell>
                    <TableCell className="text-right tabular-nums text-muted-foreground">{peso(r.grossCents)}</TableCell>
                    <TableCell className="text-right font-bold tabular-nums">{peso(r.commissionCents)}</TableCell>
                    <TableCell className="text-right tabular-nums">{r.sessions}</TableCell>
                    <TableCell className="text-right tabular-nums text-muted-foreground">{(r.minutes / 60).toFixed(1)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
