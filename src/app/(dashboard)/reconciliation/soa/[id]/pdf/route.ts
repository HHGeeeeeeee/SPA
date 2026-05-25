import { NextResponse, type NextRequest } from 'next/server';

import { renderSoaPdf } from '@/lib/soa-pdf';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const r = await renderSoaPdf(id);
  if (!r) return new NextResponse('SOA not found', { status: 404 });
  return new NextResponse(new Uint8Array(r.buffer), {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="${r.filename}"`,
    },
  });
}
