import { NextResponse, type NextRequest } from 'next/server';
import JSZip from 'jszip';

import { renderTipPdf } from '@/lib/tip-pdf';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Bundle selected tip settlements into a ZIP of separate per-settlement PDFs.
export async function GET(req: NextRequest) {
  const ids = (new URL(req.url).searchParams.get('ids') ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  if (ids.length === 0) return new NextResponse('No settlement ids', { status: 400 });

  const zip = new JSZip();
  let added = 0;
  for (const id of ids.slice(0, 100)) {
    const r = await renderTipPdf(id);
    if (r) { zip.file(r.filename, r.buffer); added += 1; }
  }
  if (added === 0) return new NextResponse('No settlements found', { status: 404 });

  const buf = await zip.generateAsync({ type: 'nodebuffer' });
  const stamp = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Manila', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
  return new NextResponse(new Uint8Array(buf), {
    headers: {
      'Content-Type': 'application/zip',
      'Content-Disposition': `attachment; filename="tip-settlements-${stamp}.zip"`,
    },
  });
}
