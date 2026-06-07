import { NextResponse, type NextRequest } from 'next/server';

import { renderCommissionXlsx } from '@/lib/commission-xlsx';
import { currentSession, isManager } from '@/lib/auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// HR payroll-upload export. `?ids=a,b,c` → one workbook with all selected
// periods' lines (Remarks = each line's settlement no). Manager-only: this is
// payroll-bound commission data.
export async function GET(req: NextRequest) {
  if (!isManager(await currentSession())) return new NextResponse('Forbidden', { status: 403 });
  const ids = (req.nextUrl.searchParams.get('ids') ?? '').split(',').filter(Boolean);
  const r = await renderCommissionXlsx(ids);
  if (!r) return new NextResponse('No commission to export', { status: 404 });
  return new NextResponse(new Uint8Array(r.buffer), {
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="${r.filename}"`,
    },
  });
}
