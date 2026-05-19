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
  TransactionCodeFormDialog,
  type TxCodeItem,
} from '@/components/settings/transaction-code-form-dialog';
import { TransactionCodeRowActions } from '@/components/settings/transaction-code-row-actions';

export const dynamic = 'force-dynamic';

async function fetchData() {
  const supabase = createServiceClient();
  const [tc, br, pm] = await Promise.all([
    supabase
      .from('transaction_codes')
      .select(`
        id, code, branch_id, transaction_type, payment_method_id,
        debit_account, debit_subaccount, debit_branch_id,
        credit_account, credit_subaccount, credit_branch_id, active,
        branch:branches!transaction_codes_branch_id_fkey ( code ),
        payment_method:payment_methods ( code ),
        debit_branch:branches!transaction_codes_debit_branch_id_fkey ( code ),
        credit_branch:branches!transaction_codes_credit_branch_id_fkey ( code )
      `)
      .order('code'),
    supabase.from('branches').select('id, code, name').eq('active', true).order('code'),
    supabase.from('payment_methods').select('id, code, display_name').eq('active', true).order('code'),
  ]);
  if (tc.error) throw new Error(tc.error.message);
  if (br.error) throw new Error(br.error.message);
  if (pm.error) throw new Error(pm.error.message);
  return { codes: tc.data ?? [], branches: br.data ?? [], paymentMethods: pm.data ?? [] };
}

function GLCell({ acct, sub, branch }: { acct: string | null; sub: string | null; branch?: string | null }) {
  if (!acct) return <span className="text-muted-foreground font-medium">—</span>;
  return (
    <span className="font-mono font-bold tabular text-xs">
      {acct}
      {sub ? <span className="text-muted-foreground"> / {sub}</span> : null}
      {branch ? <span className="ml-1 text-primary">@{branch}</span> : null}
    </span>
  );
}

export default async function TransactionCodesPage() {
  const { codes, branches, paymentMethods } = await fetchData();
  const activeCount = codes.filter((c) => c.active).length;

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
          <h2 className="text-3xl font-bold tracking-tight mt-1">Transaction Codes</h2>
          <p className="text-sm font-semibold text-muted-foreground mt-1">
            {codes.length} total · {activeCount} active · Drives ERP GL postings (Acumatica)
          </p>
        </div>
        <TransactionCodeFormDialog
          branches={branches}
          paymentMethods={paymentMethods}
          trigger={
            <Button>
              <Plus className="size-4" />
              Add Code
            </Button>
          }
        />
      </div>

      <Card className="p-0 overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="font-bold">Code</TableHead>
              <TableHead className="w-20 font-bold">Branch</TableHead>
              <TableHead className="w-24 font-bold">Type</TableHead>
              <TableHead className="font-bold">Method</TableHead>
              <TableHead className="font-bold">DR (Account / Sub @ Br)</TableHead>
              <TableHead className="font-bold">CR (Account / Sub @ Br)</TableHead>
              <TableHead className="w-24 font-bold">Status</TableHead>
              <TableHead className="w-12" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {codes.length === 0 ? (
              <TableRow>
                <TableCell colSpan={8} className="text-center py-12">
                  <p className="text-sm font-semibold text-muted-foreground">
                    No transaction codes yet.
                  </p>
                </TableCell>
              </TableRow>
            ) : (
              codes.map((c) => {
                const branch = Array.isArray(c.branch) ? c.branch[0] : c.branch;
                const pm = Array.isArray(c.payment_method) ? c.payment_method[0] : c.payment_method;
                const dbr = Array.isArray(c.debit_branch) ? c.debit_branch[0] : c.debit_branch;
                const cbr = Array.isArray(c.credit_branch) ? c.credit_branch[0] : c.credit_branch;
                const itemRecord: TxCodeItem = {
                  id: c.id,
                  code: c.code,
                  branch_id: c.branch_id,
                  transaction_type: c.transaction_type as TxCodeItem['transaction_type'],
                  payment_method_id: c.payment_method_id,
                  debit_account: c.debit_account,
                  debit_subaccount: c.debit_subaccount,
                  debit_branch_id: c.debit_branch_id,
                  credit_account: c.credit_account,
                  credit_subaccount: c.credit_subaccount,
                  credit_branch_id: c.credit_branch_id,
                };
                return (
                  <TableRow key={c.id}>
                    <TableCell className="font-mono font-bold">{c.code}</TableCell>
                    <TableCell className="font-mono font-bold">{branch?.code ?? '—'}</TableCell>
                    <TableCell>
                      <Badge variant="secondary" className="font-bold">
                        {c.transaction_type}
                      </Badge>
                    </TableCell>
                    <TableCell className="font-mono font-bold">{pm?.code ?? '—'}</TableCell>
                    <TableCell>
                      <GLCell acct={c.debit_account} sub={c.debit_subaccount} branch={dbr?.code} />
                    </TableCell>
                    <TableCell>
                      <GLCell acct={c.credit_account} sub={c.credit_subaccount} branch={cbr?.code} />
                    </TableCell>
                    <TableCell>
                      {c.active ? (
                        <Badge className="font-bold">Active</Badge>
                      ) : (
                        <Badge variant="secondary" className="font-bold">Inactive</Badge>
                      )}
                    </TableCell>
                    <TableCell>
                      <TransactionCodeRowActions
                        item={{ ...itemRecord, active: c.active }}
                        branches={branches}
                        paymentMethods={paymentMethods}
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
