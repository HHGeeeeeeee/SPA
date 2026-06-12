import Link from 'next/link';
import { ChevronLeft, Plus } from 'lucide-react';

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
import {
  BillingDestinationFormDialog,
  type BillingDestinationItem,
} from '@/components/settings/billing-destination-form-dialog';
import { BillingDestinationRowActions } from '@/components/settings/billing-destination-row-actions';

export const dynamic = 'force-dynamic';

async function fetchData() {
  const supabase = createServiceClient();
  const [bd, pm, tc] = await Promise.all([
    supabase
      .from('billing_destinations')
      .select(`
        id, code, name, settlement_type, transaction_code_id,
        default_payment_method_id, credit_terms_days, active,
        default_payment_method:payment_methods ( code, display_name ),
        transaction_code:transaction_codes ( code, debit_account, credit_account )
      `)
      .order('code'),
    supabase.from('payment_methods').select('id, code, display_name').eq('active', true).order('code'),
    // The bound code drives the AR (掛帳) booking line for this destination.
    supabase
      .from('transaction_codes')
      // branches ↔ transaction_codes now has several FKs (the branch default
      // bindings) — the embed must name the code's own branch_id FK explicitly.
      .select('id, code, transaction_type, debit_account, credit_account, branch:branches!transaction_codes_branch_id_fkey ( code )')
      .eq('active', true)
      .eq('transaction_type', 'payment')
      .order('code'),
  ]);
  if (bd.error) throw new Error(bd.error.message);
  if (pm.error) throw new Error(pm.error.message);
  if (tc.error) throw new Error(tc.error.message);
  const transactionCodes = (tc.data ?? []).map((t) => ({
    id: t.id,
    code: t.code,
    transaction_type: t.transaction_type,
    debit_account: t.debit_account,
    credit_account: t.credit_account,
    branch_code: (Array.isArray(t.branch) ? t.branch[0] : t.branch)?.code ?? null,
  }));
  return { destinations: bd.data ?? [], paymentMethods: pm.data ?? [], transactionCodes };
}

export default async function BillingDestinationsPage() {
  const { destinations, paymentMethods, transactionCodes } = await fetchData();
  const activeCount = destinations.filter((b) => b.active).length;

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
          <h2 className="text-3xl font-bold tracking-tight mt-1">Billing Destinations</h2>
          <p className="text-sm font-semibold text-muted-foreground mt-1">
            {destinations.length} total · {activeCount} active · Defines who pays + how AR settles
          </p>
        </div>
        <BillingDestinationFormDialog
          paymentMethods={paymentMethods}
          transactionCodes={transactionCodes}
          trigger={
            <Button>
              <Plus className="size-4" />
              Add Destination
            </Button>
          }
        />
      </div>

      <Card className="p-0 overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="font-bold">Code</TableHead>
              <TableHead className="font-bold">Name</TableHead>
              <TableHead className="font-bold">Settlement</TableHead>
              <TableHead className="font-bold">Transaction Code</TableHead>
              <TableHead className="font-bold">Default Payment</TableHead>
              <TableHead className="w-24 font-bold">Credit Terms</TableHead>
              <TableHead className="w-24 font-bold">Status</TableHead>
              <TableHead className="w-12" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {destinations.length === 0 ? (
              <TableRow>
                <TableCell colSpan={8} className="text-center py-12">
                  <p className="text-sm font-semibold text-muted-foreground">
                    No billing destinations yet.
                  </p>
                </TableCell>
              </TableRow>
            ) : (
              destinations.map((b) => {
                const pm = Array.isArray(b.default_payment_method)
                  ? b.default_payment_method[0]
                  : b.default_payment_method;
                const tc = Array.isArray(b.transaction_code) ? b.transaction_code[0] : b.transaction_code;
                const itemRecord: BillingDestinationItem = {
                  id: b.id,
                  code: b.code,
                  name: b.name,
                  settlement_type: b.settlement_type as BillingDestinationItem['settlement_type'],
                  transaction_code_id: b.transaction_code_id,
                  default_payment_method_id: b.default_payment_method_id,
                  credit_terms_days: b.credit_terms_days,
                };
                return (
                  <TableRow key={b.id}>
                    <TableCell className="font-mono font-bold">{b.code}</TableCell>
                    <TableCell className="font-semibold">{b.name}</TableCell>
                    <TableCell>
                      {b.settlement_type === 'intercompany' ? (
                        <Badge variant="secondary" className="font-bold">Intercompany</Badge>
                      ) : (
                        <Badge variant="default" className="font-bold">Third-Party</Badge>
                      )}
                    </TableCell>
                    <TableCell className="font-mono font-bold tabular text-xs">
                      {tc ? (
                        <>
                          {tc.code}
                          <span className="text-muted-foreground"> · {tc.debit_account ?? '—'}→{tc.credit_account ?? '—'}</span>
                        </>
                      ) : (
                        <span className="text-muted-foreground font-medium">—</span>
                      )}
                    </TableCell>
                    <TableCell className="font-medium">
                      {pm ? (
                        <span className="font-mono font-bold">{pm.code}</span>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </TableCell>
                    <TableCell className="font-bold tabular">{b.credit_terms_days}d</TableCell>
                    <TableCell>
                      {b.active ? (
                        <Badge className="font-bold">Active</Badge>
                      ) : (
                        <Badge variant="secondary" className="font-bold">Inactive</Badge>
                      )}
                    </TableCell>
                    <TableCell>
                      <BillingDestinationRowActions
                        item={{ ...itemRecord, active: b.active }}
                        paymentMethods={paymentMethods}
                        transactionCodes={transactionCodes}
                      />
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
