'use server';

import { createServiceClient } from '@/lib/supabase/server';
import { currentSession, isManager } from '@/lib/auth';
import { getAllowedBranchIds, getAllowedBranches } from '@/lib/branch-access';
import { computeDayOccupancy, type DayOccupancy } from '@/lib/occupancy';
import { REVENUE_DIMENSION_KEYS, SERVICE_LINE_STATUSES, DEFAULT_STATUSES, OCCUPANCY_DIMS } from './dimensions';

export type ReportResult<T> = { ok: true; rows: T[] } | { ok: false; error: string };

// One grouped row. Dimension columns are dynamic (keyed by the chosen dimension
// keys); the measures are always present.
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

// --- Occupancy report ------------------------------------------------------

// Report 2 can group by date and/or station branch (the only dimensions an
// occupancy ratio has a denominator for). RevPATH = net revenue per available
// therapist-hour (the spa analogue of hotel RevPAR).
// OCCUPANCY_DIMS imported from ./dimensions (a 'use server' file can't export
// non-function values like an array).

export interface OccupancyRow {
  date: string | null;          // null when not grouped by date
  branchId: string | null;
  branchLabel: string | null;   // null when not grouped by station branch
  computable: boolean;
  note: string | null;
  bedHours: number;
  therapistHours: number;
  capacityHours: number;
  actualHours: number;
  utilizationPct: number | null;
  stationOccPct: number | null;
  therapistOccPct: number | null;
  stationCount: number;
  therapistCount: number;
  absentHours: number;
  // Money (revenue-bearing lines) for the same group key, from report_revenue.
  sales_cents: number;
  discount_cents: number;
  net_cents: number;
  commission_cents: number;
  net_of_commission_cents: number;
  // Net revenue ÷ available therapist-hours, in cents per hour (null if no hours).
  revpathCents: number | null;
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

// The occupancy fields shared by a single day and an aggregate of days.
type OccCore = Pick<
  OccupancyRow,
  | 'computable' | 'note' | 'bedHours' | 'therapistHours' | 'capacityHours' | 'actualHours'
  | 'utilizationPct' | 'stationOccPct' | 'therapistOccPct' | 'stationCount' | 'therapistCount' | 'absentHours'
>;

function single(d: DayOccupancy): OccCore {
  return {
    computable: d.computable, note: d.note,
    bedHours: d.bedHours, therapistHours: d.therapistHours,
    capacityHours: d.capacityHours, actualHours: d.actualHours,
    utilizationPct: d.utilizationPct, stationOccPct: d.stationOccPct, therapistOccPct: d.therapistOccPct,
    stationCount: d.stationCount, therapistCount: d.therapistCount, absentHours: d.absentHours,
  };
}

// Aggregate several days into one row: ratios are SUM(numerator)/SUM(denominator),
// never an average of percentages. Numerators are recovered from each day's pct ×
// its hours. Station / therapist counts don't sum across days → take the max.
function fold(days: DayOccupancy[]): OccCore {
  const ok = days.filter((d) => d.computable);
  if (!ok.length) {
    return {
      computable: false, note: days.find((d) => d.note)?.note ?? 'not computable',
      bedHours: 0, therapistHours: 0, capacityHours: 0, actualHours: 0,
      utilizationPct: null, stationOccPct: null, therapistOccPct: null,
      stationCount: 0, therapistCount: 0, absentHours: 0,
    };
  }
  let bedHours = 0, therapistHours = 0, capacityHours = 0, actualHours = 0, absentHours = 0;
  let bedOcc = 0, therOcc = 0, stationCount = 0, therapistCount = 0;
  for (const d of ok) {
    bedHours += d.bedHours; therapistHours += d.therapistHours;
    capacityHours += d.capacityHours; actualHours += d.actualHours; absentHours += d.absentHours;
    bedOcc += (d.stationOccPct ?? 0) * d.bedHours;
    therOcc += (d.therapistOccPct ?? 0) * d.therapistHours;
    stationCount = Math.max(stationCount, d.stationCount);
    therapistCount = Math.max(therapistCount, d.therapistCount);
  }
  return {
    computable: true, note: null,
    bedHours, therapistHours, capacityHours, actualHours, absentHours,
    utilizationPct: capacityHours > 0 ? actualHours / capacityHours : null,
    stationOccPct: bedHours > 0 ? bedOcc / bedHours : null,
    therapistOccPct: therapistHours > 0 ? therOcc / therapistHours : null,
    stationCount, therapistCount,
  };
}

export async function generateOccupancyReport(params: {
  from: string;
  to: string;
  branchIds: string[];
  groupBy: string[];
}): Promise<ReportResult<OccupancyRow>> {
  if (!isManager(await currentSession())) return { ok: false, error: 'Not authorised' };
  if (!params.from || !params.to) return { ok: false, error: 'Pick a date range' };

  const branchIds = await resolveBranchIds(params.branchIds);
  if (!branchIds.length) return { ok: false, error: 'No accessible branches selected' };

  const days = dateRange(params.from, params.to);
  if (!days.length) return { ok: false, error: 'Invalid date range' };

  const groupBy = params.groupBy.filter((g) => (OCCUPANCY_DIMS as readonly string[]).includes(g));
  const groupDate = groupBy.includes('service_date');
  const groupBranch = groupBy.includes('station_branch');

  const selected = (await getAllowedBranches()).filter((b) => branchIds.includes(b.id));

  // Money for the same grouping via report_revenue, keyed by date|branchName.
  const supabase = createServiceClient();
  const moneyDims: string[] = [];
  if (groupDate) moneyDims.push('service_date');
  if (groupBranch) moneyDims.push('station_branch');
  const { data: moneyRows, error: moneyErr } = await supabase.rpc('report_revenue', {
    p_from: params.from,
    p_to: params.to,
    p_dimensions: moneyDims,
    p_statuses: DEFAULT_STATUSES,
    p_branch_ids: branchIds,
    p_settled_only: false,
  });
  if (moneyErr) return { ok: false, error: moneyErr.message };
  const moneyByKey = new Map<string, typeof ZERO_MONEY>();
  for (const r of (moneyRows ?? []) as RevenueRow[]) {
    const k = `${groupDate ? String(r.service_date ?? '') : '*'}|${groupBranch ? String(r.station_branch ?? '') : '*'}`;
    moneyByKey.set(k, {
      sales_cents: Number(r.sales_cents) || 0,
      discount_cents: Number(r.discount_cents) || 0,
      net_cents: Number(r.net_cents) || 0,
      commission_cents: Number(r.commission_cents) || 0,
      net_of_commission_cents: Number(r.net_of_commission_cents) || 0,
    });
  }

  const buildRow = (date: string | null, branch: { id: string; name: string } | null, occ: OccCore): OccupancyRow => {
    const money = moneyByKey.get(`${date ?? '*'}|${branch?.name ?? '*'}`) ?? ZERO_MONEY;
    return {
      date,
      branchId: branch?.id ?? null,
      branchLabel: branch?.name ?? null,
      ...occ,
      ...money,
      // RevPATH: net cents ÷ available therapist-hours = cents per hour.
      revpathCents: occ.therapistHours > 0 ? money.net_cents / occ.therapistHours : null,
    };
  };

  const rows: OccupancyRow[] = [];
  if (groupBranch) {
    // Per branch (own beds + its share-group therapist pool), then by date or aggregated.
    for (const b of selected) {
      const perDay = await Promise.all(days.map((d) => computeDayOccupancy([b.id], d)));
      if (groupDate) days.forEach((d, i) => rows.push(buildRow(d, b, single(perDay[i]))));
      else rows.push(buildRow(null, b, fold(perDay)));
    }
  } else {
    // All selected branches pooled (correct therapist-sharing semantics).
    const perDay = await Promise.all(days.map((d) => computeDayOccupancy(branchIds, d)));
    if (groupDate) days.forEach((d, i) => rows.push(buildRow(d, null, single(perDay[i]))));
    else rows.push(buildRow(null, null, fold(perDay)));
  }
  return { ok: true, rows };
}