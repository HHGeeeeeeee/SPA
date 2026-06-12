import Link from 'next/link';
import { ChevronLeft, Check, Plus, X } from 'lucide-react';

import { createServiceClient } from '@/lib/supabase/server';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Card } from '@/components/ui/card';
import { PaymentMethodFormDialog, type PaymentMethodItem } from '@/components/settings/payment-method-form-dialog';
import { PaymentMethodRowActions } from '@/components/settings/payment-method-row-actions';

export const dynamic = 'force-dynamic';

async function fetchMethods() {
  const supabase = createServiceClient();
  const [methods, codes] = await Promise.all([
    supabase
      .from('payment_methods')
      .select(`
        id, code, display_name, currency, method_type,
        manual_reconciliation, requires_reference, active,
        transaction_code_id,
        transaction_code:transaction_codes ( code )
      `)
      .order('code'),
    supabase
      .from('transaction_codes')
      .select('id, code')
      .eq('transaction_type', 'payment')
      .eq('active', true)
      .order('code'),
  ]);
  if (methods.error) throw new Error(methods.error.message);
  if (codes.error) throw new Error(codes.error.message);
  return { methods: methods.data ?? [], transactionCodes: codes.data ?? [] };
}

function Yes({ on }: { on: boolean }) {
  return on ? (
    <Check className="size-4 text-primary" strokeWidth={3} />
  ) : (
    <X className="size-4 text-muted-foreground" strokeWidth={3} />
  );
}

export default async function PaymentMethodsPage() {
  const { methods, transactionCodes } = await fetchMethods();
  const activeCount = methods.filter((m) => m.active).length;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <Link
            href="/settings"
            className="inline-flex items-center gap-1 text-xs font-semibold text-muted-foreground hover:text-foreground"
          >
            <ChevronLeft className="size-3" />
            Settings
          </Link>
          <h2 className="text-3xl font-bold tracking-tight mt-1">Payment Methods</h2>
          <p className="text-sm font-semibold text-muted-foreground mt-1">
            {methods.length} total · {activeCount} active · GL posting is defined per Transaction Code
          </p>
        </div>
        <PaymentMethodFormDialog
          transactionCodes={transactionCodes}
          trigger={
            <Button>
              <Plus className="size-4" />
              Add Method
            </Button>
          }
        />
      </div>

      <Card className="p-0 overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-44 font-bold">Code</TableHead>
              <TableHead className="font-bold">Display Name</TableHead>
              <TableHead className="w-28 font-bold">Currency</TableHead>
              <TableHead className="w-32 font-bold">Type</TableHead>
              <TableHead className="w-44 font-bold">Transaction Code</TableHead>
              <TableHead className="w-40 font-bold">Manual Reconcile</TableHead>
              <TableHead className="w-44 font-bold">Requires Reference</TableHead>
              <TableHead className="w-24 font-bold">Status</TableHead>
              <TableHead className="w-12" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {methods.length === 0 ? (
              <TableRow>
                <TableCell colSpan={9} className="text-center py-12">
                  <p className="text-sm font-semibold text-muted-foreground">No payment methods yet.</p>
                </TableCell>
              </TableRow>
            ) : (
              methods.map((m) => {
                const boundCode = Array.isArray(m.transaction_code) ? m.transaction_code[0] : m.transaction_code;
                const itemRecord: PaymentMethodItem = {
                  id: m.id,
                  code: m.code,
                  display_name: m.display_name,
                  currency: m.currency,
                  method_type: m.method_type as PaymentMethodItem['method_type'],
                  manual_reconciliation: m.manual_reconciliation,
                  requires_reference: m.requires_reference,
                  transaction_code_id: m.transaction_code_id,
                };
                return (
                  <TableRow key={m.id}>
                    <TableCell className="font-mono font-bold">{m.code}</TableCell>
                    <TableCell className="font-semibold">{m.display_name}</TableCell>
                    <TableCell className="font-bold">{m.currency}</TableCell>
                    <TableCell className="font-mono font-medium text-muted-foreground text-xs">
                      {m.method_type}
                    </TableCell>
                    <TableCell className="font-mono font-bold">{boundCode?.code ?? '—'}</TableCell>
                    <TableCell><Yes on={m.manual_reconciliation} /></TableCell>
                    <TableCell><Yes on={m.requires_reference} /></TableCell>
                    <TableCell>
                      {m.active ? (
                        <Badge className="font-bold">Active</Badge>
                      ) : (
                        <Badge variant="secondary" className="font-bold">Inactive</Badge>
                      )}
                    </TableCell>
                    <TableCell>
                      <PaymentMethodRowActions item={{ ...itemRecord, active: m.active }} transactionCodes={transactionCodes} />
                    </TableCell>
                  </TableRow>
                );
              })
            )}
          </TableBody>
        </Table>
      </Card>
    </div>
  );
}
