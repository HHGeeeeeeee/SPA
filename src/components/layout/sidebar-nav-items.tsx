import {
  LayoutDashboard,
  CalendarDays,
  CalendarClock,
  Receipt,
  Wallet,
  BookOpen,
  Settings,
  KeyRound,
  LogOut,
  Users,
  Building2,
  Database,
  CircleAlert,
  BarChart3,
  Scale,
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
  /** Hide from non-admin viewers. Matches the same flag on NavItem; used for
   *  child links inside admin-only sub-menus (e.g. Settings → Users). */
  adminOnly?: boolean;
  /** Hide from non-manager viewers (staff / external booker). Matches the
   *  same flag on NavItem; used for child links inside an otherwise-mixed
   *  sub-menu (e.g. Reconciliation → all back-office settlements; Shift Cash
   *  Count stays open). */
  managerOnly?: boolean;
  /** When true, accountant role also sees this item even if it would
   *  otherwise be hidden by adminOnly / managerOnly. */
  accountantAllowed?: boolean;
}

export interface NavSubGroup {
  label: string;
  items: NavSubItem[];
}

export interface NavItem {
  label: string;
  href?: string;
  icon: LucideIcon;
  /** Hide this item unless the viewer is admin. Used for modules that aren't
   *  rolled out to staff / manager yet (e.g. Stored Value Cards). */
  adminOnly?: boolean;
  /** Hide this item unless the viewer is manager+ (manager or admin). Used to
   *  scope manager-and-up surfaces like Settings, keeping staff / external
   *  booker out of administrative areas entirely. */
  managerOnly?: boolean;
  /** When true, accountant role also sees this item even if it would
   *  otherwise be hidden by adminOnly / managerOnly. */
  accountantAllowed?: boolean;
  children?: NavSubItem[];
  childGroups?: NavSubGroup[];
}

export const mainNavItems: NavItem[] = [
  { label: 'Dashboard', href: '/dashboard', icon: LayoutDashboard },
  // Calendar (the live per-day board) + Shift Schedule (the weekly roster that
  // feeds it) lead the list — the desk's daily-start workflow precedes taking
  // individual orders against it.
  { label: 'Calendar', href: '/calendar', icon: CalendarClock },
  { label: 'Sales Remittance', href: '/reconciliation/shift-remittance', icon: Receipt },
  { label: 'Shift Schedule', href: '/shift-schedule', icon: CalendarDays },
  // Pending Reschedules child temporarily disabled (2026-05-31) — re-enable
  // when the reschedule handling option is re-added to interrupt-taxonomy.
  // Sales Orders is reachable from the Calendar control bar (opens in a new tab),
  // not the sidebar.

  // Customers carries the Stored Value Cards entry in its page header (admin-only)
  // rather than a top-level nav item, keeping SVC tucked under the customer area.
  { label: 'Customers', href: '/customers', icon: Users, managerOnly: true },
  // Waitlist consolidated into Reservations (walk-ins use "Next available"); the
  // page/route stays but is off the nav.
  {
    label: 'Reconciliation',
    icon: Wallet,
    href: '/reconciliation',
    children: [
      // Cash + revenue close moved to the shift-based Sales Remittance flow, so
      // the old Daily Close trio (End of Day / Shift Cash Count / Revenue
      // Confirm) is off the nav. What's left is the periodic back-office cadence.
      // Periodic trio — scheduled rhythm rather than daily must-do: Tip and
      // Commission settle semi-monthly, AR cadence depends on each billing
      // destination's credit terms. Left un-sectioned (no header label) so they
      // render as a plain segment. All three are manager+ surfaces.
      { label: 'Tip Settlement', href: '/reconciliation/tips', managerOnly: true },
      { label: 'Commission Settlement', href: '/reconciliation/commission', managerOnly: true },
      { label: 'Accounts Receivable', href: '/reconciliation/soa', managerOnly: true },
    ],
  },
  { label: 'Report Builder', href: '/report-builder', icon: BarChart3, managerOnly: true },
  { label: 'System Compare', href: '/system-compare', icon: Scale, managerOnly: true },
  { label: 'Incidents', href: '/incidents', icon: CircleAlert },
  { label: 'Help', href: '/help', icon: BookOpen },
  {
    label: 'Settings',
    icon: Settings,
    managerOnly: true,
    accountantAllowed: true,
    childGroups: [
      {
        label: 'Organization',
        items: [
          { label: 'Branches', href: '/settings/branches' },
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
          { label: 'Transaction Codes', href: '/settings/transaction-codes', adminOnly: true, accountantAllowed: true },
        ],
      },
      {
        label: 'System',
        items: [
          // Users is manager+ (sees + manages) per the 2026-05-31 permission
          // matrix — was admin-only briefly. Other System items stay admin.
          { label: 'Users', href: '/settings/users' },
          { label: 'System Settings', href: '/settings/system', adminOnly: true },
          { label: 'Roles & Permissions', href: '/settings/roles', adminOnly: true },
          { label: 'Audit Log', href: '/settings/audit-log', adminOnly: true },
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
