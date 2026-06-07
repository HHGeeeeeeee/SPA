'use server';

import { createServiceClient } from '@/lib/supabase/server';
import { currentSession, isManager } from '@/lib/auth';
import { getAllowedBranchIds } from '@/lib/branch-access';
import { computeDayOccupancy } from '@/lib/occupancy';
import { REVENUE_DIMENSION_KEYS, SERVICE_LINE_STATUSES, DEFAULT_STATUSES } from './dimensions';

export type ReportResult<T> = { ok: true; rows: T[] } | { ok: false; error: string };

// One grouped row. Dimension columns are dynamic (keyed by the chosen dimension
// keys); the five measures are always present.
export interface RevenueRow {
  line_count: number;
  sales_cents: number;
  discount_cents: number;
  net_cents: number;
  commission_cents: number;
  net_of_commission_cents: number;
  [dim: string]: string | number | null;
}

export interface RevenueParams {
  from: string;
  to: string;
  dimensions: string[];
  statuses: string[];
  branchIds: string[];   // [] → all allowed
  settledOnly: boolean;
}

// Resolve the branch set the query may touch: the user's selection intersected
// with what they're allowed to see, defaulting to all-allowed when none chosen.
async function resolveBranchIds(requested: string[]): Promise<string[]> {
  const allowed = await getAllowedBranchIds();
  if (!requested.length) return [...allowed];
  return requested.filter((id) => allowed.has(id));
}

export async function generateRevenueReport(params: RevenueParams): Promise<ReportResult<RevenueRow>> {
  if (!isManager(await currentSession())) return { ok: false, error: 'Not authorised' };
  if (!params.from || !params.to) return { ok: false, error: 'Pick a date range' };

  const dimensions = params.dimensions.filter((d) => REVENUE_DIMENSION_KEYS.includes(d));
  const statuses = params.statuses.filter((s) => (SERVICE_LINE_STATUSES as readonly string[]).includes(s));
  if (!statuses.length) return { ok: false, error: 'Pick at least one status' };

  const branchIds = await resolveBranchIds(params.branchIds);
  if (!branchIds.length) return { ok: false, error: 'No accessible branches selected' };

  const supabase = createServiceClient();
  const { data, error } = await supabase.rpc('report_revenue', {
    p_from: params.from,
    p_to: params.to,
    p_dimensions: dimensions,
    p_statuses: statuses,
    p_branch_ids: branchIds,
    p_settled_only: params.settledOnly,
  });
  if (error) return { ok: false, error: error.message };
  return { ok: true, rows: (data ?? []) as RevenueRow[] };
}

export interface OccupancyRow {
  date: string;
  computable: boolean;
  note: string | null;
  capacityHours: number;
  actualHours: number;
  utilizationPct: number | null;
  stationOccPct: number | null;
  therapistOccPct: number | null;
  stationCount: number;
  therapistCount: number;
  absentHours: number;
  // Per-day money (revenue-bearing lines, by order branch), merged in from
  // report_revenue so the occupancy view carries sales alongside utilization.
  sales_cents: number;
  discount_cents: number;
  net_cents: number;
  commission_cents: number;
  net_of_commission_cents: number;
}

const MAX_OCCUPANCY_DAYS = 92; // a quarter — keeps the per-day fan-out bounded

const ZERO_MONEY = { sales_cents: 0, discount_cents: 0, net_cents: 0, commission_cents: 0, net_of_commission_cents: 0 };

function dateRange(from: string, to: string): string[] {
  const out: string[] = [];
  const start = Date.parse(`${from}T00:00:00Z`);
  const end = Date.parse(`${to}T00:00:00Z`);
  if (Number.isNaN(start) || Number.isNaN(end) || end < start) return out;
  for (let t = start; t <= end && out.length < MAX_OCCUPANCY_DAYS; t += 86400000) {
    out.push(new Date(t).toISOString().slice(0, 10));
  }
  return out;
}

export async function generateOccupancyReport(params: {
  from: string;
  to: string;
  branchIds: string[];
}): Promise<ReportResult<OccupancyRow>> {
  if (!isManager(await currentSession())) return { ok: false, error: 'Not authorised' };
  if (!params.from || !params.to) return { ok: false, error: 'Pick a date range' };

  const branchIds = await resolveBranchIds(params.branchIds);
  if (!branchIds.length) return { ok: false, error: 'No accessible branches selected' };

  const days = dateRange(params.from, params.to);
  if (!days.length) return { ok: false, error: 'Invalid date range' };

  // Per-day money in one shot via the revenue RPC (grouped by date). Statuses =
  // the revenue-bearing default; access already scoped to branchIds above.
  const supabase = createServiceClient();
  const moneyByDay = new Map<string, typeof ZERO_MONEY>();
  const { data: moneyRows, error: moneyErr } = await supabase.rpc('report_revenue', {
    p_from: params.from,
    p_to: params.to,
    p_dimensions: ['service_date'],
    p_statuses: DEFAULT_STATUSES,
    p_branch_ids: branchIds,
    p_settled_only: false,
  });
  if (moneyErr) return { ok: false, error: moneyErr.message };
  for (const r of (moneyRows ?? []) as RevenueRow[]) {
    moneyByDay.set(String(r.service_date), {
      sales_cents: Number(r.sales_cents) || 0,
      discount_cents: Number(r.discount_cents) || 0,
      net_cents: Number(r.net_cents) || 0,
      commission_cents: Number(r.commission_cents) || 0,
      net_of_commission_cents: Number(r.net_of_commission_cents) || 0,
    });
  }

  // Per-day, since occupancy denominators (shifts, station hours) are day-scoped.
  const rows = await Promise.all(
    days.map(async (date): Promise<OccupancyRow> => {
      const d = await computeDayOccupancy(branchIds, date);
      return {
        date,
        computable: d.computable,
        note: d.note,
        capacityHours: d.capacityHours,
        actualHours: d.actualHours,
        utilizationPct: d.utilizationPct,
        stationOccPct: d.stationOccPct,
        therapistOccPct: d.therapistOccPct,
        stationCount: d.stationCount,
        therapistCount: d.therapistCount,
        absentHours: d.absentHours,
        ...(moneyByDay.get(date) ?? ZERO_MONEY),
      };
    }),
  );
  return { ok: true, rows };
}