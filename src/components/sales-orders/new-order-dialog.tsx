'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
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
import { Textarea } from '@/components/ui/textarea';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

import { createDraftOrder } from '@/app/(dashboard)/sales-orders/actions';

interface BusinessUnitOption {
  id: string;
  code: string;
  name: string;
}
interface BranchOption {
  id: string;
  code: string;
  name: string;
  businessUnits: BusinessUnitOption[];
}
interface SourceOption {
  id: string;
  code: string;
  name: string;
  default_billing_to_id: string | null;
}
interface BillingOption {
  id: string;
  code: string;
  name: string;
}

interface Props {
  branches: BranchOption[];
  sources: SourceOption[];
  billingDestinations: BillingOption[];
  trigger: React.ReactNode;
}

const NONE = '__none__';
const ORDER_TYPES = [
  { value: 'walk_in', label: 'Walk-in' },
  { value: 'reservation', label: 'Reservation' },
  // 'package_use' hidden until the package/redemption module exists; the enum
  // value is kept server-side so existing orders stay valid.
  { value: 'stored_value', label: 'Stored Value' },
  { value: 'external', label: 'External (Hotel)' },
];

function todayPHT(): string {
  // YYYY-MM-DD in Asia/Manila
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Manila',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}

export function NewOrderDialog({ branches, sources, billingDestinations, trigger }: Props) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();

  const initialBranchId = branches[0]?.id ?? '';
  const initialUnits = branches.find((b) => b.id === initialBranchId)?.businessUnits ?? [];
  // Walk-in is the default order type → default the source to WALK-IN and let its
  // billing (SELF) flow through. Self-pay is the SELF destination, not null.
  const walkInSource = sources.find((s) => s.code === 'WALK-IN') ?? null;
  const selfBillingId = billingDestinations.find((b) => b.code === 'SELF')?.id ?? '';

  const [branchId, setBranchId] = useState(initialBranchId);
  const [businessUnitId, setBusinessUnitId] = useState(initialUnits[0]?.id ?? '');
  const [sourceId, setSourceId] = useState(walkInSource?.id ?? NONE);
  const [billingId, setBillingId] = useState(walkInSource?.default_billing_to_id ?? selfBillingId);
  const [orderType, setOrderType] = useState('walk_in');
  const [serviceDate, setServiceDate] = useState(todayPHT());
  const [note, setNote] = useState('');

  const branchOptions = branches.map((b) => ({ value: b.id, label: `${b.code} — ${b.name}` }));
  const selectedBranch = branches.find((b) => b.id === branchId);
  const unitOptions = (selectedBranch?.businessUnits ?? []).map((u) => ({ value: u.id, label: `${u.code} — ${u.name}` }));

  function pickBranch(v: string) {
    if (!v) return;
    setBranchId(v);
    const units = branches.find((b) => b.id === v)?.businessUnits ?? [];
    if (!units.some((u) => u.id === businessUnitId)) {
      setBusinessUnitId(units[0]?.id ?? '');
    }
  }
  const sourceOptions = [
    { value: NONE, label: 'None' },
    ...sources.map((s) => ({ value: s.id, label: `${s.code} — ${s.name}` })),
  ];
  const billingOptions = billingDestinations.map((b) => ({ value: b.id, label: `${b.code} — ${b.name}` }));

  function pickSource(v: string) {
    setSourceId(v);
    const src = sources.find((s) => s.id === v);
    // Billing follows the source; with no source, self-pay (SELF) is the default.
    setBillingId(src?.default_billing_to_id ?? selfBillingId);
  }

  // Walk-in orders default to the WALK-IN source (billing then locks to SELF).
  function pickOrderType(v: string) {
    setOrderType(v);
    if (v === 'walk_in' && walkInSource) pickSource(walkInSource.id);
  }

  const selectedSource = sources.find((s) => s.id === sourceId);
  const billingLocked = !!selectedSource?.default_billing_to_id;
  const lockedBillingLabel = billingLocked
    ? billingDestinations.find((b) => b.id === selectedSource!.default_billing_to_id)?.code ?? ''
    : '';

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    startTransition(async () => {
      const r = await createDraftOrder({
        branch_id: branchId,
        business_unit_id: businessUnitId || null,
        source_id: sourceId === NONE ? null : sourceId,
        billing_to_id: billingId && billingId !== NONE ? billingId : null,
        order_type: orderType,
        service_date: serviceDate,
        note: note || null,
      });
      if (r.ok && r.data) {
        toast.success('Draft order created');
        setOpen(false);
        router.push(`/sales-orders/${r.data.id}`);
      } else if (!r.ok) {
        toast.error(r.error);
      }
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger nativeButton={false} render={trigger as React.ReactElement} />
      <DialogContent className="sm:max-w-lg">
        <form onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle className="font-bold">New Sales Order</DialogTitle>
            <DialogDescription className="font-medium">
              Create a draft. Add customers and services on the next screen.
            </DialogDescription>
          </DialogHeader>

          <div className="grid grid-cols-2 gap-4 py-4">
            <div className="flex flex-col gap-2">
              <Label className="font-semibold">Branch *</Label>
              <Select items={branchOptions} value={branchId} onValueChange={(v) => v && pickBranch(v)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {branchOptions.map((opt) => (
                    <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="flex flex-col gap-2">
              <Label className="font-semibold">Business Unit *</Label>
              {unitOptions.length === 0 ? (
                <p className="text-sm font-medium text-muted-foreground rounded-md border border-dashed px-3 py-2">
                  This branch has no business units. Assign one in Settings → Branches.
                </p>
              ) : (
                <Select items={unitOptions} value={businessUnitId} onValueChange={(v) => v && setBusinessUnitId(v)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {unitOptions.map((opt) => (
                      <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            </div>

            <div className="flex flex-col gap-2">
              <Label className="font-semibold">Order Type *</Label>
              <Select items={ORDER_TYPES} value={orderType} onValueChange={(v) => v && pickOrderType(v)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {ORDER_TYPES.map((opt) => (
                    <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="flex flex-col gap-2">
              <Label className="font-semibold">Customer Source</Label>
              <Select items={sourceOptions} value={sourceId} onValueChange={(v) => pickSource(v ?? NONE)}>
                <SelectTrigger><SelectValue placeholder="None" /></SelectTrigger>
                <SelectContent>
                  {sourceOptions.map((opt) => (
                    <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="flex flex-col gap-2">
              <Label className="font-semibold">Billing To</Label>
              <Select items={billingOptions} value={billingId} onValueChange={(v) => setBillingId(v ?? NONE)} disabled={billingLocked}>
                <SelectTrigger><SelectValue placeholder="None" /></SelectTrigger>
                <SelectContent>
                  {billingOptions.map((opt) => (
                    <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {billingLocked && (
                <p className="text-[11px] font-medium text-muted-foreground">
                  Set by customer source — billed to {lockedBillingLabel}
                </p>
              )}
            </div>

            <div className="flex flex-col gap-2 col-span-2">
              <Label htmlFor="so-date" className="font-semibold">Service Date *</Label>
              <Input
                id="so-date"
                type="date"
                value={serviceDate}
                onChange={(e) => setServiceDate(e.target.value)}
                required
              />
            </div>

            <div className="flex flex-col gap-2 col-span-2">
              <Label htmlFor="so-note" className="font-semibold">Note</Label>
              <Textarea
                id="so-note"
                value={note}
                onChange={(e) => setNote(e.target.value)}
                rows={2}
                placeholder="Optional note for this order"
              />
            </div>
          </div>

          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => setOpen(false)} disabled={pending}>
              Cancel
            </Button>
            <Button type="submit" disabled={pending || !branchId || (unitOptions.length > 0 && !businessUnitId)}>
              {pending ? 'Creating…' : 'Create draft'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
