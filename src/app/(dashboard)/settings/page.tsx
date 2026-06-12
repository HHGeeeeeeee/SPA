import Link from 'next/link';
import {
  Building2,
  Users,
  Tags,
  Wrench,
  Percent,
  BadgeCheck,
  CreditCard,
  Banknote,
  ScrollText,
  Receipt,
  Cog,
  KeySquare,
  UserCog,
  History,
} from 'lucide-react';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { currentSession, isAdmin } from '@/lib/auth';

type SectionItem = {
  icon: typeof Building2;
  label: string;
  href: string;
  desc: string;
  adminOnly?: boolean;
};

// adminOnly hides the card from non-admin viewers (matches the page-level
// guard + sidebar filter). Manager-editable items are unmarked — manager
// sees them and the actions accept manager auth.
const sections: { group: string; items: SectionItem[] }[] = [
  {
    group: 'Core Business',
    items: [
      { icon: Building2, label: 'Branches', href: '/settings/branches', desc: 'Locations, business units & therapist-sharing groups' },
      { icon: Percent, label: 'Commission Policies', href: '/settings/commission-policies', desc: 'M / S / J class rates & per-branch warm-up rules' },
      { icon: Users, label: 'Employees', href: '/settings/employees', desc: 'Therapists & staff records, job positions' },
      { icon: Tags, label: 'Service Categories', href: '/settings/service-categories', desc: 'Massage / Hair / Nail / Rest' },
      { icon: ScrollText, label: 'Service Items Price', href: '/settings/service-items', desc: 'Service prices, validity & batch changes' },
      { icon: Wrench, label: 'Service Stations', href: '/settings/resources', desc: 'Beds, chairs, tables, rooms' },
    ],
  },
  {
    group: 'Customer & Billing',
    items: [
      { icon: Tags, label: 'Discount Classes', href: '/settings/discount-classes', desc: 'DIS-00 through DIS-99' },
      { icon: Users, label: 'Customer Sources', href: '/settings/customer-sources', desc: 'WALK-IN / Hotels / VIP / Third-Party' },
      { icon: Receipt, label: 'Billing Destinations', href: '/settings/billing-destinations', desc: 'Intercompany / Third-party billing' },
      { icon: CreditCard, label: 'Payment Methods', href: '/settings/payment-methods', desc: 'Cash / PAYMAYA / AR / SVC' },
      { icon: Banknote, label: 'Transaction Codes', href: '/settings/transaction-codes', desc: 'ERP GL postings', adminOnly: true },
    ],
  },
  {
    group: 'System',
    items: [
      { icon: UserCog, label: 'Users', href: '/settings/users', desc: 'Staff accounts and roles' },
      { icon: KeySquare, label: 'Roles & Permissions', href: '/settings/roles', desc: 'Role-based access (future)', adminOnly: true },
      { icon: Cog, label: 'System Settings', href: '/settings/system', desc: 'Magic numbers & thresholds', adminOnly: true },
      { icon: History, label: 'Audit Log', href: '/settings/audit-log', desc: 'Who changed what & when', adminOnly: true },
    ],
  },
];

export default async function SettingsLandingPage() {
  const admin = isAdmin(await currentSession());
  const visible = sections
    .map((sec) => ({ ...sec, items: sec.items.filter((it) => !it.adminOnly || admin) }))
    .filter((sec) => sec.items.length > 0);

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h2 className="text-3xl font-bold tracking-tight">Settings</h2>
        <p className="text-sm font-semibold text-muted-foreground mt-1">
          Manage master data, users, and system configuration
        </p>
      </div>

      {visible.map((sec) => (
        <div key={sec.group} className="flex flex-col gap-3">
          <h3 className="text-xs font-bold uppercase tracking-[0.15em] text-muted-foreground">
            {sec.group}
          </h3>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {sec.items.map(({ icon: Icon, label, href, desc }) => (
              <Link key={href} href={href}>
                <Card className="hover:border-primary/50 hover:bg-accent/40 transition-colors cursor-pointer h-full">
                  <CardHeader className="pb-2">
                    <CardTitle className="flex items-center gap-2 text-base font-bold">
                      <Icon className="size-4 text-primary" strokeWidth={2} />
                      {label}
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <p className="text-sm font-medium text-muted-foreground">{desc}</p>
                  </CardContent>
                </Card>
              </Link>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
