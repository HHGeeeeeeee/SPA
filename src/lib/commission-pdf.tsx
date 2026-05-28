import 'server-only';
import { Document, Page, View, Text, StyleSheet, renderToBuffer } from '@react-pdf/renderer';

import { createServiceClient } from '@/lib/supabase/server';

const one = <T,>(v: T | T[] | null): T | null => (Array.isArray(v) ? (v[0] ?? null) : v);

function php(cents: number): string {
  // Built-in Helvetica has no ₱ glyph — spell it.
  return `PHP ${(cents / 100).toLocaleString('en-US', { minimumFractionDigits: 2 })}`;
}
function todayPHT(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Manila', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
}
function longDate(ymd: string): string {
  return new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${ymd}T00:00:00Z`));
}

interface PdfCommLine { service_date: string; order_no: string; service: string; gross: number; rate: number; commission: number; warmup: boolean }
interface PdfCommGroup { therapist_name: string; sessions: number; gross: number; commission: number; lines: PdfCommLine[] }
interface PdfData {
  period_no: string;
  status: string;
  period_from: string;
  period_to: string;
  confirmed_at: string | null;
  branch_name: string;
  total_sessions: number;
  total_commission: number;
  groups: PdfCommGroup[];
}

async function loadCommissionForPdf(periodId: string): Promise<PdfData | null> {
  const supabase = createServiceClient();
  const { data: p } = await supabase
    .from('commission_periods')
    .select(`
      period_no, status, period_from, period_to, confirmed_at,
      total_sessions, total_commission_cents,
      branch:branches!commission_periods_branch_id_fkey ( name ),
      items:order_items!fk_order_items_commission_period (
        list_price_cents, commission_rate, commission_amount_cents, status, actual_start,
        therapist:employees!order_items_therapist_id_fkey ( id, name ),
        order:orders!order_items_order_id_fkey ( order_no, service_date ),
        service:service_items!order_items_service_item_id_fkey ( name )
      )
    `)
    .eq('id', periodId)
    .maybeSingle();
  if (!p) return null;

  // Bucket lines by therapist; compute warmup (earliest session of the day).
  const byTh = new Map<string, PdfCommGroup>();
  type RawLine = { service_date: string; order_no: string; service: string; gross: number; rate: number; commission: number; actual_start: string };
  const rawByTh = new Map<string, RawLine[]>();
  for (const it of (p.items ?? []).filter((i) => i.status !== 'cancelled')) {
    const th = one(it.therapist);
    if (!th) continue;
    const name = th.name ?? '—';
    const g = byTh.get(th.id ?? name) ?? { therapist_name: name, sessions: 0, gross: 0, commission: 0, lines: [] };
    g.sessions += 1;
    g.gross += it.list_price_cents ?? 0;
    g.commission += it.commission_amount_cents ?? 0;
    byTh.set(th.id ?? name, g);
    const raws = rawByTh.get(th.id ?? name) ?? [];
    raws.push({
      service_date: one(it.order)?.service_date ?? '',
      order_no: one(it.order)?.order_no ?? '—',
      service: one(it.service)?.name ?? 'Service',
      gross: it.list_price_cents ?? 0,
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
        gross: l.gross, rate: l.rate, commission: l.commission,
        warmup: !!l.actual_start && l.actual_start === earliest.get(l.service_date),
      }))
      .sort((a, b) => (a.service_date < b.service_date ? -1 : 1));
  }
  const sortedGroups = [...byTh.values()].sort((a, b) => b.commission - a.commission);

  return {
    period_no: p.period_no,
    status: p.status,
    period_from: p.period_from,
    period_to: p.period_to,
    confirmed_at: p.confirmed_at ?? null,
    branch_name: one(p.branch)?.name ?? 'HHG-SPA',
    total_sessions: p.total_sessions ?? 0,
    total_commission: p.total_commission_cents ?? 0,
    groups: sortedGroups,
  };
}

const C = '#0f172a', MUTED = '#64748b', LINE = '#e2e8f0', GROUPBG = '#f8fafc', WARM = '#92400e', WARMBG = '#fef3c7';
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

  groupHead: { flexDirection: 'row', justifyContent: 'space-between', backgroundColor: GROUPBG, paddingVertical: 6, paddingHorizontal: 6, marginTop: 10, borderTopWidth: 1, borderBottomWidth: 1, borderColor: LINE },
  groupName: { fontFamily: 'Helvetica-Bold', fontSize: 10, flex: 1 },
  groupSub: { color: MUTED, fontSize: 9, width: 110, textAlign: 'right' },
  groupTotal: { fontFamily: 'Helvetica-Bold', fontSize: 10, width: 90, textAlign: 'right' },

  rowHead: { flexDirection: 'row', backgroundColor: '#fafafa', borderBottomWidth: 1, borderBottomColor: LINE, paddingVertical: 3, paddingHorizontal: 6 },
  rowHeadCell: { fontSize: 7, color: MUTED, fontFamily: 'Helvetica-Bold', letterSpacing: 0.5 },

  row: { flexDirection: 'row', borderBottomWidth: 1, borderBottomColor: LINE, paddingVertical: 4, paddingHorizontal: 6 },
  td: { fontSize: 9 },
  cDate: { width: 60 },
  cOrder: { width: 100 },
  cSvc: { flex: 1 },
  cGross: { width: 70, textAlign: 'right' },
  cRate: { width: 40, textAlign: 'right' },
  cComm: { width: 80, textAlign: 'right' },

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
          </View>
        </View>

        <View style={styles.summary}>
          <View>
            <Text style={styles.summaryLabel}>PERIOD</Text>
            <Text style={styles.summaryVal}>{d.period_from} → {d.period_to}</Text>
          </View>
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
              <Text style={styles.groupName}>{g.therapist_name}</Text>
              <Text style={styles.groupSub}>{g.sessions} session{g.sessions === 1 ? '' : 's'} · {php(g.gross)} gross</Text>
              <Text style={styles.groupTotal}>{php(g.commission)}</Text>
            </View>
            <View style={styles.rowHead}>
              <Text style={[styles.rowHeadCell, styles.cDate]}>DATE</Text>
              <Text style={[styles.rowHeadCell, styles.cOrder]}>ORDER NO</Text>
              <Text style={[styles.rowHeadCell, styles.cSvc]}>SERVICE</Text>
              <Text style={[styles.rowHeadCell, styles.cGross]}>GROSS</Text>
              <Text style={[styles.rowHeadCell, styles.cRate]}>RATE</Text>
              <Text style={[styles.rowHeadCell, styles.cComm]}>COMMISSION</Text>
            </View>
            {g.lines.map((l, li) => (
              <View key={li} style={styles.row}>
                <Text style={[styles.td, styles.cDate]}>{l.service_date}</Text>
                <Text style={[styles.td, styles.cOrder]}>{l.order_no}</Text>
                <View style={[styles.cSvc, { flexDirection: 'row', alignItems: 'center' }]}>
                  <Text style={styles.td}>{l.service}</Text>
                  {l.warmup && <Text style={styles.warm}>warm-up</Text>}
                </View>
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
