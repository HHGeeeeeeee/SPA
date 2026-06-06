import 'server-only';
import { Document, Page, View, Text, StyleSheet, renderToBuffer } from '@react-pdf/renderer';

import { createServiceClient } from '@/lib/supabase/server';

function php(cents: number): string {
  // Built-in Helvetica has no ₱ glyph, so spell the currency.
  return `${(cents / 100).toLocaleString('en-US', { maximumFractionDigits: 0 })}`;
}
const one = <T,>(v: T | T[] | null): T | null => (Array.isArray(v) ? (v[0] ?? null) : v);

interface PdfLine { date: string; order_no: string; guest: string; service: string; mins: number | null; net: number }
interface PdfData {
  soa_no: string; status: string; settlement_type: string | null;
  period_from: string; period_to: string; issued_date: string | null; due_date: string | null; term_days: number | null;
  total_cents: number; billing_code: string | null; billing_name: string | null;
  branchName: string;
  lines: PdfLine[];
}

function todayPHT(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Manila', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
}
function longDate(ymd: string): string {
  return new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${ymd}T00:00:00Z`));
}

async function loadSoaForPdf(soaId: string): Promise<PdfData | null> {
  const supabase = createServiceClient();
  const { data: s } = await supabase
    .from('revenue_soa')
    .select(`
      soa_no, status, settlement_type, period_from, period_to, issued_date, due_date, total_cents,
      billing:billing_destinations!revenue_soa_billing_to_id_fkey ( code, name )
    `)
    .eq('id', soaId)
    .maybeSingle();
  if (!s) return null;
  const b = one(s.billing);

  // SOA is folio-based: the statement's orders are those carrying an AR line in
  // this session (order_id not null). De-dupe orders, then list their services.
  const { data: arLines } = await supabase
    .from('folio_lines')
    .select(`
      order_id,
      order:orders!folio_lines_order_id_fkey (
        id, order_no, service_date,
        branch:branches ( name ),
        order_customers ( id, customer_name, seq_no ),
        order_items ( order_customer_id, duration_minutes, list_price_cents, final_amount_cents, status, service:service_items ( name ) )
      )
    `)
    .eq('soa_session_id', soaId)
    .not('order_id', 'is', null);

  type PdfOrder = {
    id: string; order_no: string; service_date: string;
    branch: { name: string } | { name: string }[] | null;
    order_customers: { id: string; customer_name: string; seq_no: number }[] | null;
    order_items: { order_customer_id: string | null; duration_minutes: number | null; list_price_cents: number | null; final_amount_cents: number | null; status: string; service: { name: string } | { name: string }[] | null }[] | null;
  };
  const orders = new Map<string, PdfOrder>();
  for (const r of arLines ?? []) {
    const o = one(r.order) as PdfOrder | null;
    if (o?.id && !orders.has(o.id)) orders.set(o.id, o);
  }

  const lines: (PdfLine & { _seq: number })[] = [];
  const branchNames = new Set<string>();
  for (const o of orders.values()) {
    const bn = one(o.branch)?.name;
    if (bn) branchNames.add(bn);
    const nameById = new Map((o.order_customers ?? []).map((c) => [c.id, c.customer_name]));
    const seqById = new Map((o.order_customers ?? []).map((c) => [c.id, c.seq_no]));
    for (const it of o.order_items ?? []) {
      if (it.status === 'cancelled') continue;
      // Skip zero-list-price junk lines (same rule as the History grid — a
      // real service always has a list price; 0 means placeholder/orphan).
      if ((it.list_price_cents ?? 0) <= 0) continue;
      lines.push({
        date: o.service_date,
        order_no: o.order_no,
        guest: nameById.get(it.order_customer_id ?? '') ?? 'Guest',
        service: one(it.service)?.name ?? 'Service',
        mins: it.duration_minutes,
        net: it.final_amount_cents ?? 0,
        _seq: seqById.get(it.order_customer_id ?? '') ?? 99,
      });
    }
  }
  lines.sort((a, c) => a.date.localeCompare(c.date) || a.order_no.localeCompare(c.order_no) || a._seq - c._seq);

  // Net terms = the credit window snapshotted at generation (issued → due).
  const termDays = s.issued_date && s.due_date
    ? Math.round((Date.parse(`${s.due_date}T00:00:00Z`) - Date.parse(`${s.issued_date}T00:00:00Z`)) / 86400000)
    : null;

  return {
    soa_no: s.soa_no, status: s.status, settlement_type: s.settlement_type,
    period_from: s.period_from, period_to: s.period_to, issued_date: s.issued_date, due_date: s.due_date, term_days: termDays,
    total_cents: s.total_cents, billing_code: b?.code ?? null, billing_name: b?.name ?? null,
    branchName: branchNames.size === 1 ? [...branchNames][0] : branchNames.size > 1 ? [...branchNames].join(', ') : 'HHG-SPA',
    lines: lines.map(({ _seq, ...l }) => l),
  };
}

const C = '#0f172a', MUTED = '#64748b', LINE = '#e2e8f0', HEADBG = '#f1f5f9';
const styles = StyleSheet.create({
  page: { padding: 36, fontSize: 9, color: C, fontFamily: 'Helvetica' },
  topRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 16 },
  brand: { fontSize: 18, fontFamily: 'Helvetica-Bold' },
  sub: { fontSize: 10, color: MUTED, marginTop: 2, letterSpacing: 1 },
  metaLabel: { color: MUTED, fontSize: 8 },
  metaVal: { fontFamily: 'Helvetica-Bold', fontSize: 10, textAlign: 'right' },
  billBox: { borderWidth: 1, borderColor: LINE, borderRadius: 4, padding: 10, marginBottom: 14 },
  billTo: { color: MUTED, fontSize: 8, marginBottom: 2 },
  billName: { fontFamily: 'Helvetica-Bold', fontSize: 11 },
  row: { flexDirection: 'row', borderBottomWidth: 1, borderBottomColor: LINE, paddingVertical: 5 },
  headRow: { flexDirection: 'row', backgroundColor: HEADBG, paddingVertical: 6, borderTopWidth: 1, borderBottomWidth: 1, borderColor: LINE },
  th: { fontFamily: 'Helvetica-Bold', fontSize: 8, color: MUTED, paddingHorizontal: 4 },
  td: { fontSize: 9, paddingHorizontal: 4 },
  cDate: { width: 64 }, cOrder: { width: 120 }, cGuest: { width: 90 }, cSvc: { flex: 1 },
  cMins: { width: 38, textAlign: 'center' }, cNet: { width: 78, textAlign: 'right' },
  totalRow: { flexDirection: 'row', justifyContent: 'flex-end', marginTop: 12 },
  totalLabel: { fontSize: 10, color: MUTED, marginRight: 10, alignSelf: 'center' },
  totalVal: { fontSize: 14, fontFamily: 'Helvetica-Bold' },
  footer: { marginTop: 24, fontSize: 8, color: MUTED, borderTopWidth: 1, borderTopColor: LINE, paddingTop: 8 },
});

function SoaDoc({ d }: { d: PdfData }) {
  const typeLabel = (d.settlement_type ?? '').replace('_', '-');
  return (
    <Document title={`SOA ${d.soa_no}`}>
      <Page size="A4" style={styles.page}>
        <View style={styles.topRow}>
          <View>
            <Text style={styles.brand}>{d.branchName}</Text>
            <Text style={styles.sub}>STATEMENT OF ACCOUNT  ·  CURRENCY PHP</Text>
          </View>
          <View>
            <Text style={styles.metaLabel}>SOA No.</Text>
            <Text style={styles.metaVal}>{d.soa_no}</Text>
            <Text style={[styles.metaLabel, { marginTop: 4 }]}>Date</Text>
            <Text style={styles.metaVal}>{longDate(d.issued_date ?? todayPHT())}</Text>
            {d.due_date && (
              <>
                {d.term_days != null && (
                  <>
                    <Text style={[styles.metaLabel, { marginTop: 4 }]}>Terms</Text>
                    <Text style={styles.metaVal}>Net {d.term_days}</Text>
                  </>
                )}
                <Text style={[styles.metaLabel, { marginTop: 4 }]}>Due Date</Text>
                <Text style={styles.metaVal}>{longDate(d.due_date)}</Text>
              </>
            )}
          </View>
        </View>

        <View style={styles.billBox}>
          <Text style={styles.billTo}>BILL TO</Text>
          <Text style={styles.billName}>{d.billing_code ? `${d.billing_code} — ${d.billing_name ?? ''}` : '—'}</Text>
          <Text style={{ color: MUTED, marginTop: 3 }}>
            {typeLabel ? `${typeLabel.charAt(0).toUpperCase()}${typeLabel.slice(1)}` : ''}
            {`   ·   Period ${d.period_from} to ${d.period_to}`}
          </Text>
        </View>

        <View style={styles.headRow} fixed>
          <Text style={[styles.th, styles.cDate]}>DATE</Text>
          <Text style={[styles.th, styles.cOrder]}>ORDER NO</Text>
          <Text style={[styles.th, styles.cGuest]}>GUEST</Text>
          <Text style={[styles.th, styles.cSvc]}>SERVICE</Text>
          <Text style={[styles.th, styles.cMins]}>MINS</Text>
          <Text style={[styles.th, styles.cNet]}>NET</Text>
        </View>
        {d.lines.map((l, i) => (
          <View key={i} style={styles.row} wrap={false}>
            <Text style={[styles.td, styles.cDate]}>{l.date}</Text>
            <Text style={[styles.td, styles.cOrder]}>{l.order_no}</Text>
            <Text style={[styles.td, styles.cGuest]}>{l.guest}</Text>
            <Text style={[styles.td, styles.cSvc]}>{l.service}</Text>
            <Text style={[styles.td, styles.cMins]}>{l.mins ?? '—'}</Text>
            <Text style={[styles.td, styles.cNet]}>{php(l.net)}</Text>
          </View>
        ))}
        {d.lines.length === 0 && (
          <View style={styles.row}><Text style={[styles.td, { color: MUTED }]}>No orders on this statement.</Text></View>
        )}

        <View style={styles.totalRow}>
          <Text style={styles.totalLabel}>TOTAL</Text>
          <Text style={styles.totalVal}>{php(d.total_cents)}</Text>
        </View>

        <Text style={styles.footer}>{d.branchName}</Text>
      </Page>
    </Document>
  );
}

/** Render one SOA to a PDF buffer, or null if not found. */
export async function renderSoaPdf(soaId: string): Promise<{ filename: string; buffer: Buffer } | null> {
  const d = await loadSoaForPdf(soaId);
  if (!d) return null;
  const buffer = await renderToBuffer(<SoaDoc d={d} />);
  return { filename: `${d.soa_no}.pdf`, buffer };
}
