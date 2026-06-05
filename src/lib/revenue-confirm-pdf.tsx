import 'server-only';
import { Document, Page, View, Text, StyleSheet, renderToBuffer } from '@react-pdf/renderer';

import { createServiceClient } from '@/lib/supabase/server';

const one = <T,>(v: T | T[] | null): T | null => (Array.isArray(v) ? (v[0] ?? null) : v);

function php(cents: number): string {
  // Helvetica has no ₱ glyph — spell the currency.
  return `${(cents / 100).toLocaleString('en-US', { maximumFractionDigits: 0 })}`;
}
function moneyCell(cents: number): string {
  return cents > 0 ? php(cents) : '—';
}
function longDate(ymd: string): string {
  return new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${ymd}T00:00:00Z`));
}

interface PdfOrderRow {
  order_no: string;
  pax: number;
  is_ar: boolean;
  billing_label: string;
  cash: number;
  paymaya: number;
  ar: number;
  total: number;
  tip: number;
}
interface PdfData {
  branch_code: string;
  branch_name: string;
  service_date: string;     // The day the orders were rendered (period)
  posted_date: string;      // The day the GL was actually posted
  batch_nbr: string;
  orders: PdfOrderRow[];
  totals: { cash: number; paymaya: number; ar: number; total: number; tip: number };
}

/** Load every order tied to a given Acumatica GL batch. They should all share
 *  the same branch + service_date because the batched confirm posts one
 *  voucher per branch/day — but we still surface the actual values rather
 *  than trusting that invariant. */
async function loadForPdf(batchNbr: string): Promise<PdfData | null> {
  const supabase = createServiceClient();
  const { data: arPm } = await supabase.from('payment_methods').select('id').eq('code', 'ar').maybeSingle();
  const arId = arPm?.id ?? null;

  // gl_batch_nbr isn't in the generated DB types yet — cast the filter through.
  const { data } = await (supabase.from('orders') as unknown as {
    select: (c: string) => { eq: (c: string, v: string) => { order: (c: string) => Promise<{ data: unknown[] | null }> } };
  })
    .select(`
      id, order_no, service_date,
      branch:branches!orders_branch_id_fkey ( code, name ),
      billing:billing_destinations!orders_billing_to_id_fkey ( code, name, default_payment_method_id ),
      order_customers ( id ),
      folio_lines ( amount_cents, kind, method:payment_methods ( code ) ),
      tips ( amount_cents ),
      total_cents
    `)
    .eq('gl_batch_nbr', batchNbr)
    .order('order_no') as { data: Array<{
      id: string; order_no: string; service_date: string;
      branch: { code: string; name: string } | { code: string; name: string }[] | null;
      billing: { code: string; name: string; default_payment_method_id: string | null } | { code: string; name: string; default_payment_method_id: string | null }[] | null;
      order_customers: { id: string }[] | null;
      folio_lines: { amount_cents: number; kind: string; method: { code: string } | { code: string }[] | null }[] | null;
      tips: { amount_cents: number }[] | null;
      total_cents: number;
    }> | null };
  if (!data || data.length === 0) return null;

  const br = one<{ code: string; name: string }>(data[0].branch);
  const serviceDate = data[0].service_date;
  const orders: PdfOrderRow[] = data.map((o) => {
    const b = one<{ code: string; name: string; default_payment_method_id: string | null }>(o.billing);
    const isAR = !!arId && b?.default_payment_method_id === arId;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const pays = ((o.folio_lines ?? []) as any[]).filter((p) => ['payment', 'refund'].includes(p.kind));
    const sumByCode = (code: string) =>
      pays.filter((p) => one<{ code: string }>(p.method)?.code === code).reduce((s, p) => s + (p.kind === 'refund' ? -p.amount_cents : p.amount_cents), 0);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const tip = ((o.tips ?? []) as any[]).reduce((s, t) => s + (t.amount_cents ?? 0), 0);
    return {
      order_no: o.order_no,
      pax: (o.order_customers ?? []).length,
      is_ar: isAR,
      // PDF shows just the billing CODE — the name is redundant for accounting
      // (the code is what shows up on every report). Keeps the column narrow.
      billing_label: b?.code ?? 'SELF',
      cash: sumByCode('cash'),
      paymaya: sumByCode('paymaya'),
      ar: isAR ? o.total_cents : 0,
      total: o.total_cents,
      tip,
    };
  });

  const totals = orders.reduce(
    (acc, o) => ({
      cash: acc.cash + o.cash, paymaya: acc.paymaya + o.paymaya, ar: acc.ar + o.ar,
      total: acc.total + o.total, tip: acc.tip + o.tip,
    }),
    { cash: 0, paymaya: 0, ar: 0, total: 0, tip: 0 },
  );

  return {
    branch_code: br?.code ?? '?',
    branch_name: br?.name ?? 'HHG-SPA',
    service_date: serviceDate,
    posted_date: new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Manila', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date()),
    batch_nbr: batchNbr,
    orders,
    totals,
  };
}

const C = '#0f172a', MUTED = '#64748b', LINE = '#e2e8f0', GROUPBG = '#f8fafc', SALES_BG = '#f1f5f9';
// Heavier separator line for the SALES / TIPS group brackets so the printout
// reads "these columns belong together" without ambiguity.
const GROUP_BORDER = '#94a3b8';
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

  groupBracket: { flexDirection: 'row', backgroundColor: GROUPBG, paddingVertical: 3, paddingHorizontal: 4, borderTopWidth: 1, borderColor: LINE },
  groupBracketCell: { fontSize: 7, color: MUTED, fontFamily: 'Helvetica-Bold', letterSpacing: 1, textAlign: 'center' },
  rowHead: { flexDirection: 'row', backgroundColor: '#fafafa', borderBottomWidth: 1, borderBottomColor: LINE, paddingVertical: 3, paddingHorizontal: 4 },
  rowHeadCell: { fontSize: 7, color: MUTED, fontFamily: 'Helvetica-Bold' },

  row: { flexDirection: 'row', borderBottomWidth: 1, borderBottomColor: LINE, paddingVertical: 4, paddingHorizontal: 4 },
  rowTotals: { flexDirection: 'row', backgroundColor: SALES_BG, borderTopWidth: 2, borderTopColor: '#cbd5e1', paddingVertical: 6, paddingHorizontal: 4 },
  td: { fontSize: 9 },
  cOrder: { width: 110 },
  cPax: { width: 22, textAlign: 'center' },
  // paddingRight gives "Settle" some breathing room so "Paid" / "AR" don't
  // bleed into the billing code on the next column.
  cSettle: { width: 36, paddingRight: 6 },
  cBilling: { flex: 1 },
  // Cash starts the SALES group — give it a left vertical line that runs
  // through the whole table; Total ends SALES with a right vertical line.
  cCash: { width: 56, textAlign: 'right', borderLeftWidth: 1, borderLeftColor: GROUP_BORDER, paddingLeft: 4 },
  cPaymaya: { width: 56, textAlign: 'right' },
  cAR: { width: 56, textAlign: 'right' },
  cTotal: { width: 62, textAlign: 'right', fontFamily: 'Helvetica-Bold', borderRightWidth: 1, borderRightColor: GROUP_BORDER, paddingRight: 4 },
  // Tip is its own group; padded on both sides so the vertical lines stand out.
  cTip: { width: 56, textAlign: 'right', borderRightWidth: 1, borderRightColor: GROUP_BORDER, paddingRight: 4, paddingLeft: 4 },

  footer: { marginTop: 24, fontSize: 8, color: MUTED, borderTopWidth: 1, borderTopColor: LINE, paddingTop: 8 },
});

function RevenueConfirmDoc({ d }: { d: PdfData }) {
  return (
    <Document title={`Revenue Confirm ${d.branch_code} ${d.service_date}`}>
      <Page size="A4" style={styles.page}>
        <View style={styles.topRow}>
          <View>
            <Text style={styles.brand}>{d.branch_name}</Text>
            <Text style={styles.sub}>REVENUE CONFIRM  ·  CURRENCY PHP</Text>
          </View>
          <View>
            <Text style={styles.metaLabel}>GL Voucher No.</Text>
            <Text style={styles.metaVal}>{d.batch_nbr}</Text>
            <Text style={[styles.metaLabel, { marginTop: 4 }]}>Posted</Text>
            <Text style={styles.metaVal}>{longDate(d.posted_date)}</Text>
          </View>
        </View>

        <View style={styles.summary}>
          <View>
            <Text style={styles.summaryLabel}>SERVICE DATE</Text>
            <Text style={styles.summaryVal}>{d.service_date}</Text>
          </View>
          <View>
            <Text style={styles.summaryLabel}>ORDERS</Text>
            <Text style={styles.summaryVal}>{d.orders.length}</Text>
          </View>
          <View>
            <Text style={styles.summaryLabel}>SALES</Text>
            <Text style={styles.summaryVal}>{php(d.totals.total)}</Text>
          </View>
          <View>
            <Text style={styles.summaryLabel}>TIPS (PASS-THROUGH)</Text>
            <Text style={styles.summaryVal}>{php(d.totals.tip)}</Text>
          </View>
        </View>

        {/* Two-tier header — group bracket then column names. The SALES
            bracket cell carries explicit left/right borders to bracket the
            4 child columns; TIPS uses cTip's borderRight + the SALES
            cell's borderRight as its left divider (shared line). */}
        <View style={styles.groupBracket}>
          <Text style={[styles.groupBracketCell, styles.cOrder]} />
          <Text style={[styles.groupBracketCell, styles.cPax]} />
          <Text style={[styles.groupBracketCell, styles.cSettle]} />
          <Text style={[styles.groupBracketCell, styles.cBilling]} />
          <Text style={[
            styles.groupBracketCell,
            { width: 56 * 3 + 62, borderLeftWidth: 1, borderLeftColor: GROUP_BORDER, borderRightWidth: 1, borderRightColor: GROUP_BORDER },
          ]}>SALES</Text>
          <Text style={[styles.groupBracketCell, styles.cTip]}>TIPS</Text>
        </View>
        <View style={styles.rowHead}>
          <Text style={[styles.rowHeadCell, styles.cOrder]}>ORDER NO</Text>
          <Text style={[styles.rowHeadCell, styles.cPax]}>PAX</Text>
          <Text style={[styles.rowHeadCell, styles.cSettle]}>SETTLE</Text>
          <Text style={[styles.rowHeadCell, styles.cBilling]}>BILLING</Text>
          <Text style={[styles.rowHeadCell, styles.cCash]}>CASH</Text>
          <Text style={[styles.rowHeadCell, styles.cPaymaya]}>PAYMAYA</Text>
          <Text style={[styles.rowHeadCell, styles.cAR]}>AR</Text>
          <Text style={[styles.rowHeadCell, styles.cTotal]}>TOTAL</Text>
          <Text style={[styles.rowHeadCell, styles.cTip]}>TIP</Text>
        </View>

        {d.orders.map((o, i) => (
          <View key={i} style={styles.row} wrap={false}>
            <Text style={[styles.td, styles.cOrder, { fontFamily: 'Helvetica-Bold' }]}>{o.order_no}</Text>
            <Text style={[styles.td, styles.cPax]}>{o.pax}</Text>
            <Text style={[styles.td, styles.cSettle]}>{o.is_ar ? 'AR' : 'Paid'}</Text>
            <Text style={[styles.td, styles.cBilling]}>{o.billing_label}</Text>
            <Text style={[styles.td, styles.cCash]}>{moneyCell(o.cash)}</Text>
            <Text style={[styles.td, styles.cPaymaya]}>{moneyCell(o.paymaya)}</Text>
            <Text style={[styles.td, styles.cAR]}>{moneyCell(o.ar)}</Text>
            <Text style={[styles.td, styles.cTotal]}>{php(o.total)}</Text>
            <Text style={[styles.td, styles.cTip]}>{moneyCell(o.tip)}</Text>
          </View>
        ))}

        {/* Totals row */}
        <View style={styles.rowTotals}>
          <Text style={[styles.td, styles.cOrder, { fontFamily: 'Helvetica-Bold' }]}>TOTALS</Text>
          <Text style={[styles.td, styles.cPax]} />
          <Text style={[styles.td, styles.cSettle]} />
          <Text style={[styles.td, styles.cBilling]} />
          <Text style={[styles.td, styles.cCash, { fontFamily: 'Helvetica-Bold' }]}>{moneyCell(d.totals.cash)}</Text>
          <Text style={[styles.td, styles.cPaymaya, { fontFamily: 'Helvetica-Bold' }]}>{moneyCell(d.totals.paymaya)}</Text>
          <Text style={[styles.td, styles.cAR, { fontFamily: 'Helvetica-Bold' }]}>{moneyCell(d.totals.ar)}</Text>
          <Text style={[styles.td, styles.cTotal]}>{php(d.totals.total)}</Text>
          <Text style={[styles.td, styles.cTip, { fontFamily: 'Helvetica-Bold' }]}>{moneyCell(d.totals.tip)}</Text>
        </View>

        <Text style={styles.footer}>
          {d.branch_name}  ·  Revenue Confirm {d.service_date}  ·  GL #{d.batch_nbr}
        </Text>
      </Page>
    </Document>
  );
}

/** Render the revenue-confirm voucher PDF for an Acumatica GL batch number.
 *  Returns null if no orders carry that batch_nbr (yet/anymore). */
export async function renderRevenueConfirmPdf(batchNbr: string): Promise<{ filename: string; buffer: Buffer } | null> {
  const d = await loadForPdf(batchNbr);
  if (!d) return null;
  const buffer = await renderToBuffer(<RevenueConfirmDoc d={d} />);
  return { filename: `revenue-${d.branch_code}-${d.service_date}-${d.batch_nbr}.pdf`, buffer };
}
