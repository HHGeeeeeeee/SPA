import Link from 'next/link';
import {
  Building2,
  Users,
  Tags,
  Wrench,
  Briefcase,
  BadgeCheck,
  CreditCard,
  Banknote,
  ScrollText,
  Receipt,
  Cog,
  KeySquare,
  UserCog,
} from 'lucide-react';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

const sections = [
  {
    group: 'Core Business',
    items: [
      { icon: Building2, label: 'Branches', href: '/settings/branches', desc: 'Manage shop locations' },
      { icon: Users, label: 'Employees', href: '/settings/employees', desc: 'Therapists & staff records' },
      { icon: BadgeCheck, label: 'Positions', href: '/settings/positions', desc: 'Job titles (Massage Therapist, Hair Stylist…)' },
      { icon: Briefcase, label: 'Commission Classes', href: '/settings/commission-classes', desc: 'M / S / J levels and rates' },
      { icon: Tags, label: 'Service Categories', href: '/settings/service-categories', desc: 'Massage / Hair / Nail / Rest' },
      { icon: ScrollText, label: 'Service Items', href: '/settings/service-items', desc: 'Individual services & pricing' },
      { icon: Wrench, label: 'Resources', href: '/settings/resources', desc: 'Beds, rooms, chairs' },
    ],
  },
  {
    group: 'Customer & Billing',
    items: [
      { icon: Users, label: 'Customer Sources', href: '/settings/customer-sources', desc: 'WALK-IN / Hotels / VIP / Third-Party' },
      { icon: Receipt, label: 'Billing Destinations', href: '/settings/billing-destinations', desc: 'Intercompany / Third-party billing' },
      { icon: CreditCard, label: 'Payment Methods', href: '/settings/payment-methods', desc: 'Cash / PAYMAYA / AR / SVC' },
      { icon: Banknote, label: 'Transaction Codes', href: '/settings/transaction-codes', desc: 'ERP GL postings' },
      { icon: Tags, label: 'Discount Classes', href: '/settings/discount-classes', desc: 'DIS-00 through DIS-99' },
    ],
  },
  {
    group: 'System',
    items: [
      { icon: UserCog, label: 'Users', href: '/settings/users', desc: 'Staff accounts and roles' },
      { icon: KeySquare, label: 'Roles & Permissions', href: '/settings/roles', desc: 'Role-based access (future)' },
      { icon: Cog, label: 'System Settings', href: '/settings/system', desc: 'Magic numbers & thresholds' },
    ],
  },
];

export default function SettingsLandingPage() {
  return (
    <div className="flex flex-col gap-6">
      <div>
        <h2 className="text-3xl font-bold tracking-tight">Settings</h2>
        <p className="text-sm font-semibold text-muted-foreground mt-1">
          Manage master data, users, and system configuration
        </p>
      </div>

      {sections.map((sec) => (
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
