import 'server-only';
import { Document, Page, View, Text, StyleSheet, renderToBuffer } from '@react-pdf/renderer';

import { createServiceClient } from '@/lib/supabase/server';

const one = <T,>(v: T | T[] | null): T | null => (Array.isArray(v) ? (v[0] ?? null) : v);

function php(cents: number): string {
  // Built-in Helvetica has no ₱ glyph, so spell the currency.
  return `${(cents / 100).toLocaleString('en-US', { maximumFractionDigits: 0 })}`;
}
function todayPHT(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Manila', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
}
function longDate(ymd: string): string {
  return new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${ymd}T00:00:00Z`));
}

interface PdfTipLine { date: string; order_no: string; amount: number }
interface PdfGroup { therapist_name: string; count: number; total: number; lines: PdfTipLine[] }
interface PdfData {
  settlement_no: string;
  status: string;
  period_from: string;
  period_to: string;
  posted_at: string | null;
  branch_name: string;
  total: number;
  count: number;
  groups: PdfGroup[];
}

async function loadTipForPdf(settlementId: string): Promise<PdfData | null> {
  const supabase = createServiceClient();
  const { data: s } = await supabase
    .from('tip_settlements')
    .select(`
      settlement_no, status, period_from, period_to, posted_at, subtotal_cents,
      branch:branches!tip_settlements_branch_id_fkey ( name ),
      tips (
        amount_cents,
        therapist:employees!tips_therapist_id_fkey ( id, name ),
        order:orders!tips_order_id_fkey ( order_no, service_date )
      )
    `)
    .eq('id', settlementId)
    .maybeSingle();
  if (!s) return null;

  const groups = new Map<string, PdfGroup>();
  for (const t of s.tips ?? []) {
    const th = one(t.therapist);
    const ord = one(t.order);
    if (!th) continue;
    const g = groups.get(th.id) ?? { therapist_name: th.name ?? '—', count: 0, total: 0, lines: [] };
    g.count += 1;
    g.total += t.amount_cents;
    g.lines.push({ date: ord?.service_date ?? '', order_no: ord?.order_no ?? '—', amount: t.amount_cents });
    groups.set(th.id, g);
  }
  for (const g of groups.values()) g.lines.sort((a, b) => (a.date < b.date ? -1 : 1));
  const sortedGroups = [...groups.values()].sort((a, b) => b.total - a.total);

  return {
    settlement_no: s.settlement_no,
    status: s.status,
    period_from: s.period_from,
    period_to: s.period_to,
    posted_at: s.posted_at ?? null,
    branch_name: one(s.branch)?.name ?? 'HHG-SPA',
    total: s.subtotal_cents,
    count: (s.tips ?? []).length,
    groups: sortedGroups,
  };
}

const C = '#0f172a', MUTED = '#64748b', LINE = '#e2e8f0', GROUPBG = '#f8fafc';
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
  groupSub: { color: MUTED, fontSize: 9, width: 80, textAlign: 'right' },
  groupTotal: { fontFamily: 'Helvetica-Bold', fontSize: 10, width: 90, textAlign: 'right' },

  row: { flexDirection: 'row', borderBottomWidth: 1, borderBottomColor: LINE, paddingVertical: 4, paddingHorizontal: 6 },
  td: { fontSize: 9 },
  cDate: { width: 80 },
  cOrder: { flex: 1 },
  cAmt: { width: 90, textAlign: 'right' },

  totalRow: { flexDirection: 'row', justifyContent: 'flex-end', marginTop: 14 },
  totalLabel: { fontSize: 10, color: MUTED, marginRight: 10, alignSelf: 'center' },
  totalVal: { fontSize: 14, fontFamily: 'Helvetica-Bold' },
  footer: { marginTop: 24, fontSize: 8, color: MUTED, borderTopWidth: 1, borderTopColor: LINE, paddingTop: 8 },
});

function TipDoc({ d }: { d: PdfData }) {
  return (
    <Document title={`Tip settlement ${d.settlement_no}`}>
      <Page size="A4" style={styles.page}>
        <View style={styles.topRow}>
          <View>
            <Text style={styles.brand}>{d.branch_name}</Text>
            <Text style={styles.sub}>TIP SETTLEMENT  ·  CURRENCY PHP</Text>
          </View>
          <View>
            <Text style={styles.metaLabel}>Settlement No.</Text>
            <Text style={styles.metaVal}>{d.settlement_no}</Text>
            <Text style={[styles.metaLabel, { marginTop: 4 }]}>Posted</Text>
            <Text style={styles.metaVal}>{longDate(d.posted_at ? d.posted_at.slice(0, 10) : todayPHT())}</Text>
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
            <Text style={styles.summaryLabel}>TIPS</Text>
            <Text style={styles.summaryVal}>{d.count}</Text>
          </View>
          <View>
            <Text style={styles.summaryLabel}>TOTAL</Text>
            <Text style={styles.summaryVal}>{php(d.total)}</Text>
          </View>
        </View>

        {d.groups.map((g, gi) => (
          <View key={gi} wrap={false}>
            <View style={styles.groupHead}>
              <Text style={styles.groupName}>{g.therapist_name}</Text>
              <Text style={styles.groupSub}>{g.count} tip{g.count === 1 ? '' : 's'}</Text>
              <Text style={styles.groupTotal}>{php(g.total)}</Text>
            </View>
            {g.lines.map((l, li) => (
              <View key={li} style={styles.row}>
                <Text style={[styles.td, styles.cDate]}>{l.date}</Text>
                <Text style={[styles.td, styles.cOrder]}>{l.order_no}</Text>
                <Text style={[styles.td, styles.cAmt]}>{php(l.amount)}</Text>
              </View>
            ))}
          </View>
        ))}

        {d.groups.length === 0 && (
          <View style={styles.row}><Text style={[styles.td, { color: MUTED }]}>No tips in this settlement.</Text></View>
        )}

        <View style={styles.totalRow}>
          <Text style={styles.totalLabel}>GRAND TOTAL</Text>
          <Text style={styles.totalVal}>{php(d.total)}</Text>
        </View>

        <Text style={styles.footer}>{d.branch_name}  ·  Tip settlement {d.settlement_no}</Text>
      </Page>
    </Document>
  );
}

/** Render one tip settlement to a PDF buffer, or null if not found. */
export async function renderTipPdf(settlementId: string): Promise<{ filename: string; buffer: Buffer } | null> {
  const d = await loadTipForPdf(settlementId);
  if (!d) return null;
  const buffer = await renderToBuffer(<TipDoc d={d} />);
  return { filename: `${d.settlement_no}.pdf`, buffer };
}
