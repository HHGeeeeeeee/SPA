'use client';

import { Printer } from 'lucide-react';

import { Button } from '@/components/ui/button';

/** Triggers the browser print dialog (Save as PDF) for the report page. */
export function PrintButton() {
  return (
    <Button
      variant="outline"
      size="sm"
      onClick={() => window.print()}
      className="gap-2 print:hidden"
    >
      <Printer className="size-4" />
      列印 / 存成 PDF
    </Button>
  );
}
