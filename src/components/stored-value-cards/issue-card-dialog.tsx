'use client';

import { useState, useTransition } from 'react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

import { issueCard } from '@/app/(dashboard)/stored-value-cards/actions';

interface CustomerOpt { id: string; name: string; phone: string }
interface Opt { id: string; code: string; name: string }
interface DiscountOpt { id: string; code: string; description: string }

interface Props {
  customers: CustomerOpt[];
  branches: Opt[];
  discountClasses: DiscountOpt[];
  defaultExpiryDays: number;
  trigger: React.ReactNode;
}

const NONE = '__none__';

function expiryDate(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

export function IssueCardDialog({ customers, branches, discountClasses, defaultExpiryDays, trigger }: Props) {
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();

  const [customerId, setCustomerId] = useState('');
  const [branchId, setBranchId] = useState(branches[0]?.id ?? '');
  const [initial, setInitial] = useState('');
  const [bonus, setBonus] = useState('0');
  const [discountId, setDiscountId] = useState(NONE);
  const [expires, setExpires] = useState(expiryDate(defaultExpiryDays));

  const customerOptions = customers.map((c) => ({ value: c.id, label: `${c.name} · ${c.phone}` }));
  const branchOptions = branches.map((b) => ({ value: b.id, label: `${b.code} — ${b.name}` }));
  const discOptions = [{ value: NONE, label: 'None' }, ...discountClasses.map((d) => ({ value: d.id, label: `${d.code} — ${d.description}` }))];

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!customerId) return toast.error('Pick a customer');
    if (!Number(initial)) return toast.error('Enter an initial amount');
    startTransition(async () => {
      const r = await issueCard({
        customer_id: customerId,
        branch_id: branchId,
        initial_amount: Number(initial),
        bonus_amount: Number(bonus || 0),
        discount_class_id: discountId === NONE ? null : discountId,
        expires_at: expires,
      });
      if (r.ok) { toast.success('Card issued'); setOpen(false); setInitial(''); setBonus('0'); setCustomerId(''); }
      else toast.error(r.error);
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger nativeButton={false} render={trigger as React.ReactElement} />
      <DialogContent className="sm:max-w-lg">
        <form onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle className="font-bold">Issue Stored Value Card</DialogTitle>
            <DialogDescription className="font-medium">
              Prepaid balance is a liability, not revenue. Requires a customer master record.
            </DialogDescription>
          </DialogHeader>

          <div className="grid grid-cols-2 gap-4 py-4">
            <div className="flex flex-col gap-2 col-span-2">
              <Label className="font-semibold">Customer *</Label>
              {customers.length === 0 ? (
                <p className="text-xs font-medium text-muted-foreground">
                  No customers yet. Create one in Customers first.
                </p>
              ) : (
                <Select items={customerOptions} value={customerId} onValueChange={(v) => v && setCustomerId(v)}>
                  <SelectTrigger><SelectValue placeholder="Pick a customer" /></SelectTrigger>
                  <SelectContent>
                    {customerOptions.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
                  </SelectContent>
                </Select>
              )}
            </div>
            <div className="flex flex-col gap-2">
              <Label className="font-semibold">Branch *</Label>
              <Select items={branchOptions} value={branchId} onValueChange={(v) => v && setBranchId(v)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{branchOptions.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="sv-exp" className="font-semibold">Expires *</Label>
              <Input id="sv-exp" type="date" value={expires} onChange={(e) => setExpires(e.target.value)} required />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="sv-init" className="font-semibold">Initial Amount *</Label>
              <Input id="sv-init" type="number" min="0" step="0.01" value={initial} onChange={(e) => setInitial(e.target.value)} placeholder="5000" required />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="sv-bonus" className="font-semibold">Bonus</Label>
              <Input id="sv-bonus" type="number" min="0" step="0.01" value={bonus} onChange={(e) => setBonus(e.target.value)} />
            </div>
            <div className="flex flex-col gap-2 col-span-2">
              <Label className="font-semibold">Member Discount Class</Label>
              <Select items={discOptions} value={discountId} onValueChange={(v) => setDiscountId(v ?? NONE)}>
                <SelectTrigger><SelectValue placeholder="None" /></SelectTrigger>
                <SelectContent>{discOptions.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}</SelectContent>
              </Select>
            </div>
          </div>

          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => setOpen(false)} disabled={pending}>Cancel</Button>
            <Button type="submit" disabled={pending || customers.length === 0}>{pending ? 'Issuing…' : 'Issue card'}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
