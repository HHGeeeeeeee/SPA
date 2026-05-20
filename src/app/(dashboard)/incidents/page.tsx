import { createServiceClient } from '@/lib/supabase/server';
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
import { ReportIncidentDialog } from '@/components/incidents/report-incident-dialog';
import { ResolveIncidentButton } from '@/components/incidents/resolve-incident-button';

export const dynamic = 'force-dynamic';

const SEV_VARIANT: Record<string, 'default' | 'secondary' | 'destructive'> = {
  low: 'secondary', medium: 'default', high: 'destructive',
};

async function fetchData() {
  const supabase = createServiceClient();
  const { data } = await supabase
    .from('incident_log')
    .select('id, customer_name, incident_type, severity, description, resolved, resolution_action, reported_at')
    .order('reported_at', { ascending: false })
    .limit(200);
  return data ?? [];
}

export default async function IncidentsPage() {
  const incidents = await fetchData();
  const open = incidents.filter((i) => !i.resolved).length;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-3xl font-bold tracking-tight">Incidents</h2>
          <p className="text-sm font-semibold text-muted-foreground mt-1">{incidents.length} logged · {open} open</p>
        </div>
        <ReportIncidentDialog />
      </div>

      <Card className="p-0 overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="font-bold">Customer</TableHead>
              <TableHead className="w-36 font-bold">Type</TableHead>
              <TableHead className="w-24 font-bold">Severity</TableHead>
              <TableHead className="font-bold">Description</TableHead>
              <TableHead className="w-28 font-bold">Status</TableHead>
              <TableHead className="w-28" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {incidents.length === 0 ? (
              <TableRow><TableCell colSpan={6} className="text-center py-12 text-sm font-semibold text-muted-foreground">No incidents logged.</TableCell></TableRow>
            ) : incidents.map((i) => (
              <TableRow key={i.id}>
                <TableCell className="font-semibold">{i.customer_name}</TableCell>
                <TableCell className="font-medium capitalize">{i.incident_type.replace(/_/g, ' ')}</TableCell>
                <TableCell><Badge variant={SEV_VARIANT[i.severity] ?? 'secondary'} className="font-bold capitalize">{i.severity}</Badge></TableCell>
                <TableCell className="font-medium text-muted-foreground max-w-md truncate">{i.description}</TableCell>
                <TableCell>
                  {i.resolved
                    ? <Badge variant="secondary" className="font-bold">Resolved</Badge>
                    : <Badge variant="destructive" className="font-bold">Open</Badge>}
                </TableCell>
                <TableCell>{!i.resolved && <div className="flex justify-end"><ResolveIncidentButton id={i.id} /></div>}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Card>
    </div>
  );
}
