import { NextResponse, type NextRequest } from 'next/server';

import { renderCommissionPdf } from '@/lib/commission-pdf';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const r = await renderCommissionPdf(id);
  if (!r) return new NextResponse('Commission period not found', { status: 404 });
  return new NextResponse(new Uint8Array(r.buffer), {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="${r.filename}"`,
    },
  });
}
