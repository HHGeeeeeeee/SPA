import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';

const kpis = [
  { label: 'Total Bookings', value: '18', delta: '+12%' },
  { label: 'Total PAX', value: '42', delta: '+15%' },
  { label: 'Revenue', value: '₱24,500', delta: '+8%' },
  { label: 'Tips (PAYMAYA)', value: '₱620', delta: '+20%' },
  { label: 'Discount Given', value: '₱1,200', delta: '' },
  { label: 'In Service Now', value: '6', delta: '' },
];

export default function DashboardPage() {
  return (
    <div className="flex flex-col gap-6">
      <div>
        <h2 className="text-3xl font-bold tracking-tight">Dashboard</h2>
        <p className="text-sm font-semibold text-muted-foreground mt-1">
          Today · {new Date().toLocaleDateString('en-PH', { dateStyle: 'full' })}
        </p>
      </div>

      <div className="grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-6">
        {kpis.map((k) => (
          <Card key={k.label}>
            <CardHeader className="pb-2">
              <CardTitle className="text-xs font-bold text-muted-foreground uppercase tracking-[0.12em]">
                {k.label}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-extrabold tracking-tight tabular">{k.value}</div>
              {k.delta && (
                <Badge variant="secondary" className="mt-2 text-xs font-bold">
                  {k.delta}
                </Badge>
              )}
            </CardContent>
          </Card>
        ))}
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">⚡ Action Required</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex flex-col divide-y divide-border">
            <div className="flex items-center justify-between py-3">
              <div>
                <p className="text-sm font-medium">No pending actions</p>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Action items will appear here when needed
                </p>
              </div>
              <Badge variant="secondary">Empty</Badge>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Welcome to HHG-SPA POS</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            This is a scaffolded dashboard. Database schema and full features will be added in
            upcoming commits. Use the sidebar to navigate (most pages are placeholders for now).
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
