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
  Building2,
  Database,
  CircleAlert,
  LucideIcon,
} from 'lucide-react';

export interface NavSubItem {
  label: string;
  href: string;
  // Optional grouping marker — consecutive children with the same `section`
  // are wrapped together under one labelled bar in the sidebar. Used to mark
  // the "must do daily" trio inside Reconciliation so the desk sees them as
  // one workflow rather than 6 independent links.
  section?: string;
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
  // Shift Schedule first — the desk's daily-start workflow (set up the
  // therapist/room board) precedes taking individual orders against it.
  { label: 'Shift Schedule', href: '/shift-schedule', icon: CalendarClock },
  { label: 'Sales Orders', href: '/sales-orders', icon: Receipt },
  { label: 'Reservations', href: '/reservations', icon: CalendarDays },
  { label: 'Customers', href: '/customers', icon: Users },
  // Waitlist consolidated into Reservations (walk-ins use "Next available"); the
  // page/route stays but is off the nav.
  { label: 'Stored Value Cards', href: '/stored-value-cards', icon: CreditCard },
  {
    label: 'Reconciliation',
    icon: Wallet,
    href: '/reconciliation',
    children: [
      // Daily-close trio — desk must run these every business day before EoD
      // can close. The shared section marker renders them under one labelled
      // bar so they read as a single workflow, not three independent links.
      { label: 'End of Day', href: '/reconciliation/end-of-day', section: 'Daily Close' },
      { label: 'Shift Cash Count', href: '/reconciliation/cash', section: 'Daily Close' },
      { label: 'Revenue Confirm', href: '/reconciliation/revenue-confirm', section: 'Daily Close' },
      { label: 'Tip Settlement', href: '/reconciliation/tips' },
      { label: 'Commission Settlement', href: '/reconciliation/commission' },
      { label: 'Accounts Receivable', href: '/reconciliation/soa' },
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
          { label: 'Service Items Price', href: '/settings/service-items' },
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
          { label: 'Audit Log', href: '/settings/audit-log' },
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
