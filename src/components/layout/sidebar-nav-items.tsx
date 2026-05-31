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
  /** Hide from non-admin viewers. Matches the same flag on NavItem; used for
   *  child links inside admin-only sub-menus (e.g. Settings → Users). */
  adminOnly?: boolean;
  /** Hide from non-manager viewers (staff / external booker). Matches the
   *  same flag on NavItem; used for child links inside an otherwise-mixed
   *  sub-menu (e.g. Reconciliation → all back-office settlements; Shift Cash
   *  Count stays open). */
  managerOnly?: boolean;
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
  children?: NavSubItem[];
  childGroups?: NavSubGroup[];
}

export const mainNavItems: NavItem[] = [
  { label: 'Dashboard', href: '/dashboard', icon: LayoutDashboard },
  // Shift Schedule first — the desk's daily-start workflow (set up the
  // therapist/room board) precedes taking individual orders against it.
  { label: 'Shift Schedule', href: '/shift-schedule', icon: CalendarClock },
  // Pending Reschedules child temporarily disabled (2026-05-31) — re-enable
  // when the reschedule handling option is re-added to interrupt-taxonomy.
  { label: 'Sales Orders', href: '/sales-orders', icon: Receipt },
  { label: 'Reservations', href: '/reservations', icon: CalendarDays },
  { label: 'Customers', href: '/customers', icon: Users, managerOnly: true },
  // Waitlist consolidated into Reservations (walk-ins use "Next available"); the
  // page/route stays but is off the nav.
  { label: 'Stored Value Cards', href: '/stored-value-cards', icon: CreditCard, adminOnly: true },
  {
    label: 'Reconciliation',
    icon: Wallet,
    href: '/reconciliation',
    children: [
      // Daily-close trio — desk must run these every business day before EoD
      // can close. Rendered in the primary-tinted "Daily Close" segment so
      // the urgency reads visually. EoD + Revenue Confirm are manager-driven
      // close steps; staff only owns the Cash Count.
      { label: 'End of Day', href: '/reconciliation/end-of-day', section: 'Daily Close', managerOnly: true },
      { label: 'Shift Cash Count', href: '/reconciliation/cash', section: 'Daily Close' },
      { label: 'Revenue Confirm', href: '/reconciliation/revenue-confirm', section: 'Daily Close', managerOnly: true },
      // Periodic trio — scheduled rhythm rather than daily must-do: Tip and
      // Commission settle semi-monthly, AR cadence depends on each billing
      // destination's credit terms. Rendered in a muted "Periodic" segment so
      // it visually de-emphasises versus the Daily Close cluster above. All
      // three are manager+ surfaces (back-office settlements).
      { label: 'Tip Settlement', href: '/reconciliation/tips', section: 'Periodic', managerOnly: true },
      { label: 'Commission Settlement', href: '/reconciliation/commission', section: 'Periodic', managerOnly: true },
      { label: 'Accounts Receivable', href: '/reconciliation/soa', section: 'Periodic', managerOnly: true },
    ],
  },
  { label: 'Reports', href: '/reports', icon: BarChart3, managerOnly: true },
  { label: 'Incidents', href: '/incidents', icon: CircleAlert },
  { label: 'Help', href: '/help', icon: BookOpen },
  {
    label: 'Settings',
    icon: Settings,
    managerOnly: true,
    childGroups: [
      {
        label: 'Organization',
        items: [
          { label: 'Business Units', href: '/settings/business-units', adminOnly: true },
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
          { label: 'Transaction Codes', href: '/settings/transaction-codes', adminOnly: true },
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
