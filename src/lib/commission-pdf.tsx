import 'server-only';
import { Document, Page, View, Text, StyleSheet, renderToBuffer } from '@react-pdf/renderer';

import { createServiceClient } from '@/lib/supabase/server';

const one = <T,>(v: T | T[] | null): T | null => (Array.isArray(v) ? (v[0] ?? null) : v);

function php(cents: number): string {
  // Built-in Helvetica has no ₱ glyph — spell it.
  return `${(cents / 100).toLocaleString('en-US', { maximumFractionDigits: 0 })}`;
}
function todayPHT(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Manila', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
}
function longDate(ymd: string): string {
  return new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${ymd}T00:00:00Z`));
}

interface PdfCommLine { service_date: string; order_no: string; service: string; minutes: number | null; gross: number; rate: number; commission: number; warmup: boolean }
interface PdfCommGroup {
  therapist_name: string;
  therapist_id: string | null;
  sessions: number;
  gross: number;
  // `commission` = sum of the line commissions (the engine-computed figure,
  // used for the per-line subtotal). `final` = what's actually paid =
  // computed + manual adjustment (from commission_entries). They differ only
  // when finance posted a manual adjustment on this therapist's entry.
  commission: number;
  adjustment: number;
  adjustment_reason: string | null;
  adjustment_by: string | null;
  adjustment_at: string | null;
  final: number;
  lines: PdfCommLine[];
  // When the therapist's home branch ≠ the settlement's branch, the work was
  // done as a borrow (cross-branch share) — surface the home branch code so
  // the finance desk sees who's a loaner without cross-referencing rosters.
  // null = therapist's home is the settlement branch (no badge needed).
  borrowed_from: string | null;
}
interface PdfData {
  period_no: string;
  status: string;
  period_from: string;
  period_to: string;
  confirmed_at: string | null;
  confirmed_by: string | null;
  branch_name: string;
  policy_name: string | null;
  total_sessions: number;
  total_commission: number;
  groups: PdfCommGroup[];
}

async function loadCommissionForPdf(periodId: string): Promise<PdfData | null> {
  const supabase = createServiceClient();
  const { data: p } = await supabase
    .from('commission_periods')
    .select(`
      period_no, status, period_from, period_to, confirmed_at, branch_id,
      total_sessions, total_commission_cents,
      branch:branches!commission_periods_branch_id_fkey ( name ),
      policy:commission_policies!commission_periods_commission_policy_id_fkey ( name ),
      confirmer:staff_users!commission_periods_confirmed_by_staff_id_fkey ( display_name, email ),
      entries:commission_entries!commission_entries_period_id_fkey (
        therapist_id, computed_commission_cents, adjustment_cents, adjustment_reason, adjustment_at, final_amount_cents,
        adjuster:staff_users!commission_entries_adjustment_by_staff_id_fkey ( display_name, email )
      ),
      items:order_items!fk_order_items_commission_period (
        list_price_cents, final_amount_cents, duration_minutes, commission_rate, commission_amount_cents, status, actual_start,
        therapist_home_branch_id,
        therapist:employees!order_items_therapist_id_fkey ( id, name ),
        order:orders!order_items_order_id_fkey ( order_no, service_date ),
        service:service_items!order_items_service_item_id_fkey ( name )
      )
    `)
    .eq('id', periodId)
    .maybeSingle();
  if (!p) return null;

  // Branch-code lookup (id → code) for the borrowed-from badge. The PDF
  // displays codes (e.g. "MNL") rather than UUIDs — finance desk speaks codes.
  const { data: branches } = await supabase.from('branches').select('id, code');
  const branchCode = new Map((branches ?? []).map((b) => [b.id as string, b.code as string]));

  // Entry (therapist × period) lookup — carries the computed figure + manual
  // adjustment. The group subtotal is taken from here (final_amount_cents) so
  // the PDF reflects adjustments; the per-line breakdown stays computed.
  const entryByTh = new Map((p.entries ?? []).map((e) => [e.therapist_id as string, e]));

  // Bucket lines by therapist; compute warmup (earliest session of the day).
  // Borrowed-from is per-line (snapshotted on order_items.therapist_home_branch_id
  // at booking time) but rolls up to the group: a therapist is shown as
  // borrowed if ANY of their lines in this period was done outside their home
  // branch. The displayed home-branch code uses the first non-null snapshot —
  // a therapist only has one home at a time, so all snapshots match.
  const byTh = new Map<string, PdfCommGroup>();
  type RawLine = { service_date: string; order_no: string; service: string; minutes: number | null; gross: number; rate: number; commission: number; actual_start: string };
  const rawByTh = new Map<string, RawLine[]>();
  for (const it of (p.items ?? []).filter((i) => i.status !== 'cancelled')) {
    const th = one(it.therapist);
    if (!th) continue;
    const name = th.name ?? '—';
    const g = byTh.get(th.id ?? name) ?? { therapist_name: name, therapist_id: th.id ?? null, sessions: 0, gross: 0, commission: 0, adjustment: 0, adjustment_reason: null, adjustment_by: null, adjustment_at: null, final: 0, lines: [], borrowed_from: null };
    g.sessions += 1;
    // gross = NET (final_amount = list_price − discount): the commission base.
    g.gross += it.final_amount_cents ?? it.list_price_cents ?? 0;
    g.commission += it.commission_amount_cents ?? 0;
    // Resolve borrowed-from once per group: settlement branch ≠ therapist's
    // snapshot home branch ⇒ loaner; remember the home code for the badge.
    if (g.borrowed_from === null && it.therapist_home_branch_id && it.therapist_home_branch_id !== p.branch_id) {
      g.borrowed_from = branchCode.get(it.therapist_home_branch_id) ?? null;
    }
    byTh.set(th.id ?? name, g);
    const raws = rawByTh.get(th.id ?? name) ?? [];
    raws.push({
      service_date: one(it.order)?.service_date ?? '',
      order_no: one(it.order)?.order_no ?? '—',
      service: one(it.service)?.name ?? 'Service',
      minutes: it.duration_minutes ?? null,
      gross: it.final_amount_cents ?? it.list_price_cents ?? 0,
      rate: Number(it.commission_rate ?? 0),
      commission: it.commission_amount_cents ?? 0,
      actual_start: it.actual_start ?? '',
    });
    rawByTh.set(th.id ?? name, raws);
  }
  for (const [key, g] of byTh) {
    const raws = rawByTh.get(key) ?? [];
    const earliest = new Map<string, string>();
    for (const l of raws) {
      const cur = earliest.get(l.service_date);
      if (l.actual_start && (!cur || l.actual_start < cur)) earliest.set(l.service_date, l.actual_start);
    }
    g.lines = raws
      .map((l) => ({
        service_date: l.service_date, order_no: l.order_no, service: l.service,
        minutes: l.minutes,
        gross: l.gross, rate: l.rate, commission: l.commission,
        warmup: !!l.actual_start && l.actual_start === earliest.get(l.service_date),
      }))
      .sort((a, b) => (a.service_date < b.service_date ? -1 : 1));
    // Merge the settled entry's adjustment trail onto the group. Fall back to
    // the computed line-sum for legacy periods that have no entry row.
    const entry = g.therapist_id ? entryByTh.get(g.therapist_id) : undefined;
    g.adjustment = entry?.adjustment_cents ?? 0;
    g.adjustment_reason = entry?.adjustment_reason ?? null;
    const adjuster = entry ? one(entry.adjuster) : null;
    g.adjustment_by = adjuster?.display_name ?? adjuster?.email ?? null;
    g.adjustment_at = entry?.adjustment_at ?? null;
    g.final = entry?.final_amount_cents ?? g.commission;
  }
  const sortedGroups = [...byTh.values()].sort((a, b) => b.final - a.final);

  return {
    period_no: p.period_no,
    status: p.status,
    period_from: p.period_from,
    period_to: p.period_to,
    confirmed_at: p.confirmed_at ?? null,
    confirmed_by: one(p.confirmer)?.display_name ?? one(p.confirmer)?.email ?? null,
    branch_name: one(p.branch)?.name ?? 'HHG-SPA',
    policy_name: one(p.policy)?.name ?? null,
    total_sessions: p.total_sessions ?? 0,
    total_commission: p.total_commission_cents ?? 0,
    groups: sortedGroups,
  };
}

const C = '#0f172a', MUTED = '#64748b', LINE = '#e2e8f0', GROUPBG = '#f8fafc', WARM = '#92400e', WARMBG = '#fef3c7', RED = '#dc2626';
const styles = StyleSheet.create({
  page: { padding: 36, fontSize: 9, color: C, fontFamily: 'Helvetica' },
  topRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 16 },
  brand: { fontSize: 18, fontFamily: 'Helvetica-Bold' },
  sub: { fontSize: 10, color: MUTED, marginTop: 2, letterSpacing: 1 },
  metaLabel: { color: MUTED, fontSize: 8 },
  metaVal: { fontFamily: 'Helvetica-Bold', fontSize: 10, textAlign: 'right' },

  summary: { borderWidth: 1, borderColor: LINE, borderRadius: 4, padding: 10, marginBottom: 14, flexDirection: 'row', justifyContent: 'space-between' },
  summaryLabel: { color: MUTED, fontSize: 8 },
  summaryVal: { fontFamily: 'Helvetica-Bold', fontSize: 11, marginTop: 2 },

  groupHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', backgroundColor: GROUPBG, paddingVertical: 6, paddingHorizontal: 6, marginTop: 10, borderTopWidth: 1, borderBottomWidth: 1, borderColor: LINE },
  groupNameWrap: { flex: 1, flexDirection: 'row', alignItems: 'center' },
  groupName: { fontFamily: 'Helvetica-Bold', fontSize: 10 },
  groupSub: { color: MUTED, fontSize: 9, width: 110, textAlign: 'right' },
  groupTotal: { fontFamily: 'Helvetica-Bold', fontSize: 10, width: 90, textAlign: 'right' },
  // Borrowed-from badge — small amber pill next to therapist name in the
  // group header (matches warm-up tag styling) so loaner sessions are
  // visible without scanning every line.
  borrowed: { fontSize: 7, color: WARM, backgroundColor: WARMBG, paddingHorizontal: 3, paddingVertical: 1, marginLeft: 6, borderRadius: 2, fontFamily: 'Helvetica-Bold' },

  // Adjustment note under a therapist's group header — only shown when finance
  // posted a manual adjustment, so the final figure stays auditable on paper.
  adjNote: { flexDirection: 'row', justifyContent: 'flex-end', backgroundColor: GROUPBG, paddingHorizontal: 6, paddingBottom: 6 },
  // Same size as the therapist name (10pt) — the adjustment must be impossible
  // to miss on the printed sheet.
  adjNoteText: { fontSize: 10, color: C, fontFamily: 'Helvetica-Bold' },
  adjNoteVal: { fontSize: 10, color: RED, fontFamily: 'Helvetica-Bold' },
  // Who/when of the adjustment — small + muted so the amount stays the hero.
  adjNoteWho: { fontSize: 8, color: MUTED, fontFamily: 'Helvetica' },

  rowHead: { flexDirection: 'row', backgroundColor: '#fafafa', borderBottomWidth: 1, borderBottomColor: LINE, paddingVertical: 3, paddingHorizontal: 6 },
  rowHeadCell: { fontSize: 7, color: MUTED, fontFamily: 'Helvetica-Bold', letterSpacing: 0.5 },

  row: { flexDirection: 'row', borderBottomWidth: 1, borderBottomColor: LINE, paddingVertical: 4, paddingHorizontal: 6 },
  td: { fontSize: 9 },
  // Column widths — A4 usable ≈ 523pt. Order No shows only the last 4 (the
  // sequence). Service stays flex:1 to absorb residual slack.
  // Layout: cDate 60 + cOrder 44 + cSvc(flex≈221) + cMins 26 + cGross 72 + cRate 32 + cComm 68 = 523pt
  cDate: { width: 60, paddingRight: 8 },
  cOrder: { width: 44, paddingRight: 8 },
  cSvc: { flex: 1, paddingRight: 8 },
  cMins: { width: 26, paddingRight: 6, textAlign: 'right' },
  cGross: { width: 72, paddingRight: 8, textAlign: 'right' },
  cRate: { width: 32, paddingRight: 8, textAlign: 'right' },
  cComm: { width: 68, textAlign: 'right' },

  warm: { fontSize: 7, color: WARM, backgroundColor: WARMBG, paddingHorizontal: 3, paddingVertical: 1, marginLeft: 4, borderRadius: 2 },

  totalRow: { flexDirection: 'row', justifyContent: 'flex-end', marginTop: 14 },
  totalLabel: { fontSize: 10, color: MUTED, marginRight: 10, alignSelf: 'center' },
  totalVal: { fontSize: 14, fontFamily: 'Helvetica-Bold' },
  footer: { marginTop: 24, fontSize: 8, color: MUTED, borderTopWidth: 1, borderTopColor: LINE, paddingTop: 8 },
});

function CommDoc({ d }: { d: PdfData }) {
  return (
    <Document title={`Commission ${d.period_no}`}>
      <Page size="A4" style={styles.page}>
        <View style={styles.topRow}>
          <View>
            <Text style={styles.brand}>{d.branch_name}</Text>
            <Text style={styles.sub}>COMMISSION SETTLEMENT</Text>
          </View>
          <View>
            <Text style={styles.metaLabel}>Settlement No.</Text>
            <Text style={styles.metaVal}>{d.period_no}</Text>
            <Text style={[styles.metaLabel, { marginTop: 4 }]}>Confirmed</Text>
            <Text style={styles.metaVal}>{longDate(d.confirmed_at ? d.confirmed_at.slice(0, 10) : todayPHT())}</Text>
            {d.confirmed_by && <Text style={[styles.metaLabel, { marginTop: 1 }]}>Settled by {d.confirmed_by}</Text>}
          </View>
        </View>

        <View style={styles.summary}>
          <View>
            <Text style={styles.summaryLabel}>PERIOD</Text>
            <Text style={styles.summaryVal}>{d.period_from} → {d.period_to}</Text>
          </View>
          {d.policy_name && (
            <View>
              <Text style={styles.summaryLabel}>POLICY</Text>
              <Text style={styles.summaryVal}>{d.policy_name}</Text>
            </View>
          )}
          <View>
            <Text style={styles.summaryLabel}>THERAPISTS</Text>
            <Text style={styles.summaryVal}>{d.groups.length}</Text>
          </View>
          <View>
            <Text style={styles.summaryLabel}>SESSIONS</Text>
            <Text style={styles.summaryVal}>{d.total_sessions}</Text>
          </View>
          <View>
            <Text style={styles.summaryLabel}>COMMISSION</Text>
            <Text style={styles.summaryVal}>{php(d.total_commission)}</Text>
          </View>
        </View>

        {d.groups.map((g, gi) => (
          <View key={gi} wrap={false}>
            <View style={styles.groupHead}>
              <View style={styles.groupNameWrap}>
                <Text style={styles.groupName}>{g.therapist_name}</Text>
                {g.borrowed_from && <Text style={styles.borrowed}>from {g.borrowed_from}</Text>}
              </View>
              <Text style={styles.groupSub}>{g.sessions} session{g.sessions === 1 ? '' : 's'} · {php(g.gross)} net</Text>
              <Text style={styles.groupTotal}>{php(g.final)}</Text>
            </View>
            {g.adjustment !== 0 && (
              <View style={styles.adjNote}>
                <Text style={styles.adjNoteText}>
                  Computed {php(g.commission)}  ·  Adjustment <Text style={styles.adjNoteVal}>{g.adjustment < 0 ? '-' : '+'}{php(Math.abs(g.adjustment))}</Text>
                  {g.adjustment_reason ? `  (${g.adjustment_reason})` : ''}
                  {(g.adjustment_by || g.adjustment_at) && (
                    <Text style={styles.adjNoteWho}>{`   by ${g.adjustment_by ?? '—'}${g.adjustment_at ? ` · ${longDate(g.adjustment_at.slice(0, 10))}` : ''}`}</Text>
                  )}
                </Text>
              </View>
            )}
            <View style={styles.rowHead}>
              <Text style={[styles.rowHeadCell, styles.cDate]}>DATE</Text>
              <Text style={[styles.rowHeadCell, styles.cOrder]}>ORDER</Text>
              <Text style={[styles.rowHeadCell, styles.cSvc]}>SERVICE</Text>
              <Text style={[styles.rowHeadCell, styles.cMins]}>MINS</Text>
              <Text style={[styles.rowHeadCell, styles.cGross]}>NET</Text>
              <Text style={[styles.rowHeadCell, styles.cRate]}>RATE</Text>
              <Text style={[styles.rowHeadCell, styles.cComm]}>COMMISSION</Text>
            </View>
            {g.lines.map((l, li) => (
              <View key={li} style={styles.row}>
                <Text style={[styles.td, styles.cDate]}>{l.service_date}</Text>
                <Text style={[styles.td, styles.cOrder]}>{l.order_no.slice(-4)}</Text>
                <View style={[styles.cSvc, { flexDirection: 'row', alignItems: 'center' }]}>
                  <Text style={styles.td}>{l.service}</Text>
                  {l.warmup && <Text style={styles.warm}>warm-up</Text>}
                </View>
                <Text style={[styles.td, styles.cMins]}>{l.minutes ?? '—'}</Text>
                <Text style={[styles.td, styles.cGross]}>{php(l.gross)}</Text>
                <Text style={[styles.td, styles.cRate]}>{(l.rate * 100).toFixed(0)}%</Text>
                <Text style={[styles.td, styles.cComm]}>{php(l.commission)}</Text>
              </View>
            ))}
          </View>
        ))}

        {d.groups.length === 0 && (
          <View style={styles.row}><Text style={[styles.td, { color: MUTED }]}>No commission entries in this settlement.</Text></View>
        )}

        <View style={styles.totalRow}>
          <Text style={styles.totalLabel}>GRAND TOTAL</Text>
          <Text style={styles.totalVal}>{php(d.total_commission)}</Text>
        </View>

        <Text style={styles.footer}>{d.branch_name}  ·  Commission settlement {d.period_no}</Text>
      </Page>
    </Document>
  );
}

/** Render one commission settlement to a PDF buffer, or null if not found. */
export async function renderCommissionPdf(periodId: string): Promise<{ filename: string; buffer: Buffer } | null> {
  const d = await loadCommissionForPdf(periodId);
  if (!d) return null;
  const buffer = await renderToBuffer(<CommDoc d={d} />);
  return { filename: `${d.period_no}.pdf`, buffer };
}
