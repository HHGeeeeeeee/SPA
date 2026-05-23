import {
  LayoutDashboard,
  Receipt,
  CalendarDays,
  CalendarClock,
  CreditCard,
  Wallet,
  BarChart3,
  BookOpen,
  Settings,
  KeyRound,
  LogOut,
  Users,
  UserCheck,
  Building2,
  Database,
  CircleAlert,
  LucideIcon,
} from 'lucide-react';

export interface NavSubItem {
  label: string;
  href: string;
}

export interface NavSubGroup {
  label: string;
  items: NavSubItem[];
}

export interface NavItem {
  label: string;
  href?: string;
  icon: LucideIcon;
  children?: NavSubItem[];
  childGroups?: NavSubGroup[];
}

export const mainNavItems: NavItem[] = [
  { label: 'Dashboard', href: '/dashboard', icon: LayoutDashboard },
  { label: 'Sales Orders', href: '/sales-orders', icon: Receipt },
  { label: 'Shift Schedule', href: '/shift-schedule', icon: CalendarClock },
  { label: 'Customers', href: '/customers', icon: Users },
  { label: 'Reservations', href: '/reservations', icon: CalendarDays },
  { label: 'Availability', href: '/availability', icon: UserCheck },
  // Waitlist consolidated into Reservations (walk-ins use "Next available"); the
  // page/route stays but is off the nav.
  { label: 'Stored Value Cards', href: '/stored-value-cards', icon: CreditCard },
  {
    label: 'Reconciliation',
    icon: Wallet,
    children: [
      { label: 'Cash Reconciliation', href: '/reconciliation/cash' },
      { label: 'Revenue Confirm', href: '/reconciliation/revenue-confirm' },
      { label: 'Tip Settlement', href: '/reconciliation/tips' },
      { label: 'Commission Settlement', href: '/reconciliation/commission' },
      { label: 'AR Balance', href: '/reconciliation/ar-balance' },
      { label: 'Revenue SOA', href: '/reconciliation/soa' },
    ],
  },
  { label: 'Reports', href: '/reports', icon: BarChart3 },
  { label: 'Incidents', href: '/incidents', icon: CircleAlert },
  { label: 'Help', href: '/help', icon: BookOpen },
  {
    label: 'Settings',
    icon: Settings,
    childGroups: [
      {
        label: 'Organization',
        items: [
          { label: 'Business Units', href: '/settings/business-units' },
          { label: 'Branches', href: '/settings/branches' },
          { label: 'Therapist Sharing', href: '/settings/therapist-groups' },
          { label: 'Positions', href: '/settings/positions' },
          { label: 'Commission Classes', href: '/settings/commission-classes' },
          { label: 'Commission Policies', href: '/settings/commission-policies' },
          { label: 'Employees', href: '/settings/employees' },
        ],
      },
      {
        label: 'Catalog',
        items: [
          { label: 'Service Categories', href: '/settings/service-categories' },
          { label: 'Service Items', href: '/settings/service-items' },
          { label: 'Service Stations', href: '/settings/resources' },
        ],
      },
      {
        label: 'Customer & Billing',
        items: [
          { label: 'Discount Classes', href: '/settings/discount-classes' },
          { label: 'Customer Sources', href: '/settings/customer-sources' },
          { label: 'Billing Destinations', href: '/settings/billing-destinations' },
          { label: 'Payment Methods', href: '/settings/payment-methods' },
          { label: 'Transaction Codes', href: '/settings/transaction-codes' },
        ],
      },
      {
        label: 'System',
        items: [
          { label: 'Users', href: '/settings/users' },
          { label: 'System Settings', href: '/settings/system' },
        ],
      },
    ],
  },
];

export const bottomNavItems: { label: string; href: string; icon: LucideIcon; destructive?: boolean }[] = [
  { label: 'Change Password', href: '/account/change-password', icon: KeyRound },
  { label: 'Sign Out', href: '/api/auth/logout', icon: LogOut, destructive: true },
];

export { Users, Building2, Database };
