import 'server-only';
import ExcelJS from 'exceljs';

import { createServiceClient } from '@/lib/supabase/server';

const one = <T,>(v: T | T[] | null): T | null => (Array.isArray(v) ? (v[0] ?? null) : v);

// One payroll row per therapist per settlement period. PayElement code/label is
// the constant the payroll import expects; Amount is the FINAL commission (incl.
// manual adjustments); Remarks carries the settlement no so HR can trace the
// upload back to its period.
const PAY_ELEMENT_CODE = 'COMMISSION';
const PAY_ELEMENT_LABEL = 'COMMISSION';

interface PayrollRow {
  code: string;
  name: string;
  amount: number; // pesos, 2dp
  remarks: string; // settlement no
}

/**
 * Build the HR payroll-upload spreadsheet for one or more commission periods.
 * Skips void periods and zero-amount lines (nothing to pay). Returns null when
 * there's nothing to export.
 */
export async function renderCommissionXlsx(periodIds: string[]): Promise<{ filename: string; buffer: Buffer } | null> {
  const ids = periodIds.filter(Boolean);
  if (ids.length === 0) return null;

  const supabase = createServiceClient();
  const { data: entries } = await supabase
    .from('commission_entries')
    .select(`
      final_amount_cents,
      employee:employees!commission_entries_therapist_id_fkey ( employee_code, name ),
      period:commission_periods!commission_entries_period_id_fkey ( period_no, status )
    `)
    .in('period_id', ids);

  const rows: PayrollRow[] = (entries ?? [])
    .map((e) => ({ emp: one(e.employee), per: one(e.period), final: e.final_amount_cents ?? 0 }))
    // Void periods are reversed — never pay them out. Zero lines are noise.
    .filter((r) => r.per?.status !== 'void' && r.final !== 0 && r.emp)
    .map((r) => ({
      code: r.emp!.employee_code ?? '',
      name: r.emp!.name ?? '',
      amount: r.final / 100,
      remarks: r.per?.period_no ?? '',
    }))
    // Group by settlement, then by name within each — matches the on-screen order.
    .sort((a, b) => (a.remarks === b.remarks ? a.name.localeCompare(b.name) : a.remarks.localeCompare(b.remarks)));

  if (rows.length === 0) return null;

  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Commission');
  ws.columns = [
    { header: 'EmployeeCode', key: 'code', width: 14 },
    { header: 'EmployeeName', key: 'name', width: 26 },
    { header: 'PayElementCode', key: 'peCode', width: 16 },
    { header: 'PayElement', key: 'pe', width: 16 },
    { header: 'Amount', key: 'amount', width: 12 },
    { header: 'Remarks', key: 'remarks', width: 28 },
  ];
  ws.getRow(1).font = { bold: true };
  for (const r of rows) {
    const row = ws.addRow({
      code: r.code,
      name: r.name,
      peCode: PAY_ELEMENT_CODE,
      pe: PAY_ELEMENT_LABEL,
      amount: r.amount,
      remarks: r.remarks,
    });
    row.getCell('amount').numFmt = '#,##0.00';
  }

  const buffer = Buffer.from(await wb.xlsx.writeBuffer());
  // Single period → name the file after its settlement no; many → generic.
  const uniquePeriods = [...new Set(rows.map((r) => r.remarks))];
  const filename = uniquePeriods.length === 1 ? `${uniquePeriods[0]}.xlsx` : 'commission-payroll.xlsx';
  return { filename, buffer };
}
