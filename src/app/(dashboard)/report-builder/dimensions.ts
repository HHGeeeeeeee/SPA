// Shared metadata for the Report Builder — imported by both the client UI (to
// render the pickers) and the server action (to validate input). The dimension
// KEYS here must match the whitelist in the report_revenue() SQL function
// (migration 20260607140000); the function rejects anything not in its map.

export interface DimensionDef {
  key: string;
  label: string;
}

// Revenue report dimensions (free combination). Order here is the default
// column order in the result table.
export const REVENUE_DIMENSIONS: DimensionDef[] = [
  { key: 'service_date', label: 'Date' },
  { key: 'scheduled_hour', label: 'Start Hour' },
  { key: 'order_branch', label: 'Order Branch' },
  { key: 'station_branch', label: 'Station Branch' },
  { key: 'source', label: 'Source' },
  { key: 'category', label: 'Category' },
  { key: 'service', label: 'Service' },
  { key: 'therapist', label: 'Therapist' },
  { key: 'station', label: 'Station' },
  { key: 'status', label: 'Status' },
  { key: 'duration', label: 'Duration (min)' },
];

export const REVENUE_DIMENSION_KEYS = REVENUE_DIMENSIONS.map((d) => d.key);

// order_items.status — valid values from the v2 status machine. `cancelled` is
// excluded by default so cancelled lines don't inflate net revenue.
export const SERVICE_LINE_STATUSES = [
  'draft',
  'in_service',
  'service_completed',
  'interrupted',
  'cancelled',
  'no_show',
] as const;

export type ServiceLineStatus = (typeof SERVICE_LINE_STATUSES)[number];

// Default status filter: the revenue-bearing states (delivered / in progress).
export const DEFAULT_STATUSES: ServiceLineStatus[] = ['in_service', 'service_completed', 'interrupted'];

export const STATUS_LABELS: Record<ServiceLineStatus, string> = {
  draft: 'Draft',
  in_service: 'In Service',
  service_completed: 'Completed',
  interrupted: 'Interrupted',
  cancelled: 'Cancelled',
  no_show: 'No-show',
};

// Measures always returned by report_revenue (in display order).
export const MEASURES: { key: string; label: string; money: boolean }[] = [
  { key: 'line_count', label: 'Lines', money: false },
  { key: 'sales_cents', label: 'Sales', money: true },
  { key: 'discount_cents', label: 'Discount', money: true },
  { key: 'net_cents', label: 'Net', money: true },
  { key: 'commission_cents', label: 'Commission', money: true },
  { key: 'net_of_commission_cents', label: 'Net of Comm.', money: true },
];