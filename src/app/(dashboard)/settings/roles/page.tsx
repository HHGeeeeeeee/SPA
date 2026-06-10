import Link from 'next/link';
import { redirect } from 'next/navigation';
import {
  ChevronLeft,
  ShieldCheck,
  ShieldUser,
  Calculator,
  Eye,
  Users,
  Building2,
  Check,
  X,
} from 'lucide-react';

import { currentSession, isAdmin } from '@/lib/auth';
import { createServiceClient } from '@/lib/supabase/server';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';

export const dynamic = 'force-dynamic';

const ROLES = [
  {
    code: 'admin',
    label: 'Admin',
    icon: ShieldCheck,
    color: 'destructive',
    description: 'Full access — manage all settings, users, and operations',
    capabilities: [
      'All staff/manager capabilities',
      'Edit Master Data (Services, Pricing, Branches, etc.)',
      'Edit Transaction Codes & ERP postings',
      'Manage Users + Roles + Permissions',
      'Change System Settings (Magic Numbers)',
      'View all branches',
    ],
  },
  {
    code: 'manager',
    label: 'Manager',
    icon: ShieldUser,
    color: 'default',
    description: 'Store operations + approvals + reconciliation',
    capabilities: [
      'All staff capabilities',
      'Approve Void / DIS-90 / DIS-91 via Manager PIN',
      'Reopen Completed Orders',
      'Revenue Confirm (daily close)',
      'Shift Cash Count approval',
      'Tip & Commission Settlement',
      'Generate / Settle Revenue SOA',
      'Service station status management',
      'Adjust shift schedules',
    ],
  },
  {
    code: 'accountant',
    label: 'Accountant',
    icon: Calculator,
    color: 'default',
    description: 'Accounting configuration — edit financial master data',
    capabilities: [
      'All staff capabilities (POS, Calendar, Payments)',
      'Edit Transaction Codes & GL mappings',
      'Edit Payment Methods',
      'Edit Service Categories',
      'View other Settings pages (read-only)',
    ],
  },
  {
    code: 'staff',
    label: 'Staff',
    icon: Users,
    color: 'secondary',
    description: 'Daily POS work — counter operations',
    capabilities: [
      'Create / edit Sales Orders (Draft / Open)',
      'Add Customers / Reservations / Waitlist',
      'Take Payments (Cash / PAYMAYA / SVC)',
      'Open / Top-up Stored Value Cards',
      'View Service Stations & Calendar',
      'Mark resources cleaning / maintenance (short-term)',
      'Submit feedback on customer behalf',
    ],
  },
  {
    code: 'viewer',
    label: 'Viewer',
    icon: Eye,
    color: 'secondary',
    description: 'Read-only access — same visibility as Manager, no write operations',
    capabilities: [
      'View Dashboard, Calendar, Shift Schedule',
      'View Sales Orders & Remittance',
      'View Reconciliation (Tips, Commission, AR)',
      'View Reports & System Compare',
      'View all Settings pages (read-only)',
      'No create / edit / delete / approve actions',
    ],
  },
  {
    code: 'external_booker',
    label: 'External Booker',
    icon: Building2,
    color: 'secondary',
    description: 'Hotel front-desk staff — reservation-only access',
    capabilities: [
      'Create + view Reservations (their own only)',
      'Modify / cancel own reservations',
      'No access to pricing / billing / Sales Orders',
      'No financial visibility',
    ],
  },
] as const;

export default async function RolesPage() {
  if (!isAdmin(await currentSession())) redirect('/dashboard');
  // Future: load role_permissions overrides
  const supabase = createServiceClient();
  const { data: overrides } = await supabase
    .from('role_permissions')
    .select('role, permission_name, enabled')
    .order('role');

  const grouped: Record<string, { name: string; enabled: boolean }[]> = {};
  for (const o of overrides ?? []) {
    grouped[o.role] = grouped[o.role] || [];
    grouped[o.role].push({ name: o.permission_name, enabled: o.enabled });
  }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <Link
          href="/settings"
          className="inline-flex items-center gap-1 text-xs font-semibold text-muted-foreground hover:text-foreground"
        >
          <ChevronLeft className="size-3" />
          Settings
        </Link>
        <h2 className="text-3xl font-bold tracking-tight mt-1">Roles & Permissions</h2>
        <p className="text-sm font-semibold text-muted-foreground mt-1">
          6 built-in roles · Custom permission overrides stored in <span className="font-mono">role_permissions</span> (UI coming in v2)
        </p>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        {ROLES.map((r) => {
          const Icon = r.icon;
          return (
            <Card key={r.code}>
              <CardHeader className="pb-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <div className="grid size-8 place-items-center rounded-lg bg-primary/10 text-primary">
                      <Icon className="size-4" strokeWidth={2} />
                    </div>
                    <CardTitle className="text-lg font-bold">{r.label}</CardTitle>
                  </div>
                  <Badge
                    variant={r.color as 'default' | 'destructive' | 'secondary'}
                    className="font-mono font-bold text-xs"
                  >
                    {r.code}
                  </Badge>
                </div>
                <p className="text-sm font-semibold text-muted-foreground mt-2">
                  {r.description}
                </p>
              </CardHeader>
              <CardContent>
                <div className="flex flex-col gap-1.5">
                  {r.capabilities.map((cap) => (
                    <div key={cap} className="flex items-start gap-2 text-sm">
                      <Check className="size-4 text-primary mt-0.5 shrink-0" strokeWidth={3} />
                      <span className="font-medium">{cap}</span>
                    </div>
                  ))}
                </div>

                {grouped[r.code] && grouped[r.code].length > 0 && (
                  <div className="mt-4 pt-3 border-t border-border">
                    <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground mb-2">
                      Custom Overrides
                    </p>
                    <div className="flex flex-col gap-1">
                      {grouped[r.code].map((p) => (
                        <div key={p.name} className="flex items-center gap-2 text-xs">
                          {p.enabled ? (
                            <Check className="size-3 text-primary" strokeWidth={3} />
                          ) : (
                            <X className="size-3 text-destructive" strokeWidth={3} />
                          )}
                          <span className="font-mono font-semibold">{p.name}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          );
        })}
      </div>

      <Card className="bg-muted/30 border-dashed">
        <CardContent className="py-4">
          <p className="text-sm font-semibold text-muted-foreground">
            ℹ Note: For v1, capabilities are hard-coded in application logic. Custom
            <span className="font-mono"> role_permissions </span>
            overrides go in via SQL or a future admin UI. The six roles cannot be deleted.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
