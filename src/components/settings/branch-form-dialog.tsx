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

import { createBranch, updateBranch } from '@/app/(dashboard)/settings/branches/actions';

const NONE = '__none__';

interface CommissionClass { id: string; class_code: string; name: string; commission_rate: number }
interface BranchFormDialogProps {
  mode?: 'create' | 'edit';
  branch?: { id: string; code: string; name: string; business_unit_ids: string[]; open_time?: string | null; close_time?: string | null; therapist_share_group?: string | null; commission_policy_id?: string | null; commission_rate_overrides?: { commission_class_id: string; rate: number }[]; has_kiosk_passcode?: boolean };
  businessUnits: { id: string; code: string; name: string }[];
  commissionPolicies?: { id: string; code: string; name: string }[];
  commissionClasses?: CommissionClass[];
  /** Existing therapist-sharing group labels across branches — offered as
   *  autocomplete so two branches can be put in the same pool by name. */
  shareGroupSuggestions?: string[];
  trigger?: React.ReactNode;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}

export function BranchFormDialog({
  mode = 'create',
  branch,
  businessUnits,
  commissionPolicies = [],
  commissionClasses = [],
  shareGroupSuggestions = [],
  trigger,
  open: controlledOpen,
  onOpenChange: controlledOnOpenChange,
}: BranchFormDialogProps) {
  const [internalOpen, setInternalOpen] = useState(false);
  const open = controlledOpen ?? internalOpen;
  const setOpen = controlledOnOpenChange ?? setInternalOpen;
  const [code, setCode] = useState(branch?.code ?? '');
  const [name, setName] = useState(branch?.name ?? '');
  const [unitIds, setUnitIds] = useState<string[]>(branch?.business_unit_ids ?? []);
  const [openTime, setOpenTime] = useState(branch?.open_time?.slice(0, 5) ?? '10:00');
  const [closeTime, setCloseTime] = useState(branch?.close_time?.slice(0, 5) ?? '02:00');
  const [shareGroup, setShareGroup] = useState(branch?.therapist_share_group ?? '');
  const [kioskPasscode, setKioskPasscode] = useState('');
  const [policyId, setPolicyId] = useState(branch?.commission_policy_id ?? NONE);
  // Per-class rate overrides for this branch: classId → percent string ('' = use global).
  const [rates, setRates] = useState<Record<string, string>>(
    Object.fromEntries((branch?.commission_rate_overrides ?? []).map((o) => [o.commission_class_id, String(Math.round(o.rate * 100))])),
  );
  const setRate = (classId: string, v: string) => setRates((p) => ({ ...p, [classId]: v }));
  const [pending, startTransition] = useTransition();
  const policyOptions = [{ value: NONE, label: 'None (default rate, no warm-up)' }, ...commissionPolicies.map((p) => ({ value: p.id, label: `${p.code} — ${p.name}` }))];

  const isEdit = mode === 'edit';

  function toggleUnit(id: string) {
    setUnitIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
    );
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (unitIds.length === 0) {
      toast.error('Pick at least one business unit');
      return;
    }
    startTransition(async () => {
      const commission_policy_id = policyId === NONE ? null : policyId;
      const commission_rate_overrides = commissionClasses
        .filter((c) => (rates[c.id] ?? '').trim() !== '')
        .map((c) => ({ commission_class_id: c.id, rate: Math.max(0, Math.min(1, (Number(rates[c.id]) || 0) / 100)) }));
      const therapist_share_group = shareGroup.trim() || null;
      const kiosk_passcode = kioskPasscode.trim() || undefined;
      const result = isEdit
        ? await updateBranch({ id: branch!.id, name, business_unit_ids: unitIds, open_time: openTime, close_time: closeTime, therapist_share_group, commission_policy_id, commission_rate_overrides, kiosk_passcode })
        : await createBranch({ code, name, business_unit_ids: unitIds, open_time: openTime, close_time: closeTime, therapist_share_group, commission_policy_id, commission_rate_overrides, kiosk_passcode });
      if (result.ok) {
        toast.success(isEdit ? 'Branch updated' : 'Branch created');
        setOpen(false);
        if (!isEdit) {
          setCode('');
          setName('');
          setUnitIds([]);
          setShareGroup('');
          setKioskPasscode('');
        }
      } else {
        toast.error(result.error);
      }
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      {trigger ? (
        <DialogTrigger render={trigger as React.ReactElement} />
      ) : null}
      <DialogContent className="sm:max-w-md">
        <form onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle className="font-bold">
              {isEdit ? `Edit Branch: ${branch?.code}` : 'New Branch'}
            </DialogTitle>
            <DialogDescription className="font-medium">
              {isEdit
                ? 'Branch code is immutable. Other fields can be updated.'
                : 'Create a new branch / location.'}
            </DialogDescription>
          </DialogHeader>

          <div className="flex flex-col gap-4 py-4">
            <div className="flex flex-col gap-2">
              <Label htmlFor="branch-code" className="font-semibold">
                Code *
              </Label>
              <Input
                id="branch-code"
                value={code}
                onChange={(e) => setCode(e.target.value.toUpperCase())}
                placeholder="OSP1"
                disabled={isEdit}
                required
                pattern="[A-Z0-9_-]+"
                maxLength={20}
              />
              <p className="text-xs font-medium text-muted-foreground">
                Uppercase letters, digits, - and _ only. Cannot be changed later.
              </p>
            </div>

            <div className="flex flex-col gap-2">
              <Label htmlFor="branch-name" className="font-semibold">
                Display Name *
              </Label>
              <Input
                id="branch-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Oriental SPA 1"
                required
                maxLength={120}
              />
            </div>

            <div className="flex flex-col gap-2">
              <Label className="font-semibold">Business Units *</Label>
              <div className="flex flex-col gap-1 rounded-lg border border-input p-2">
                {businessUnits.length === 0 ? (
                  <p className="text-xs font-medium text-muted-foreground px-2 py-1">
                    No business units defined. Create one in Settings → Business Units first.
                  </p>
                ) : (
                  businessUnits.map((b) => (
                    <label
                      key={b.id}
                      className="flex items-center gap-2 cursor-pointer rounded-md px-2 py-1.5 hover:bg-accent"
                    >
                      <input
                        type="checkbox"
                        className="size-4 cursor-pointer accent-primary"
                        checked={unitIds.includes(b.id)}
                        onChange={() => toggleUnit(b.id)}
                      />
                      <span className="text-sm font-semibold">{b.name}</span>
                      <span className="text-xs font-mono text-muted-foreground">{b.code}</span>
                    </label>
                  ))
                )}
              </div>
              <p className="text-xs font-medium text-muted-foreground">
                Which business lines operate at this branch. A single location can host
                more than one (e.g. SPA + Gym).
              </p>
            </div>

            <div className="flex flex-col gap-2">
              <Label className="font-semibold">Business hours</Label>
              <div className="flex items-center gap-2">
                <Input type="time" value={openTime} onChange={(e) => setOpenTime(e.target.value)} className="w-32" />
                <span className="text-sm font-semibold text-muted-foreground">to</span>
                <Input type="time" value={closeTime} onChange={(e) => setCloseTime(e.target.value)} className="w-32" />
              </div>
              <p className="text-xs font-medium text-muted-foreground">
                Drives the Calendar board. A close time at or before the open
                time means the branch trades past midnight (e.g. 10:00 → 02:00).
              </p>
            </div>

            <div className="flex flex-col gap-2">
              <Label htmlFor="branch-share-group" className="font-semibold">Therapist sharing group</Label>
              <Input
                id="branch-share-group"
                list="branch-share-groups"
                value={shareGroup}
                onChange={(e) => setShareGroup(e.target.value)}
                placeholder="(none)"
                maxLength={60}
              />
              <datalist id="branch-share-groups">
                {shareGroupSuggestions.map((g) => <option key={g} value={g} />)}
              </datalist>
              <p className="text-xs font-medium text-muted-foreground">
                Branches with the same label pool their therapists — they show up in
                each other&apos;s Calendar and can be borrowed on orders. Leave
                blank for no sharing.
              </p>
            </div>

            <div className="flex flex-col gap-2">
              <Label htmlFor="branch-kiosk-passcode" className="font-semibold">Kiosk passcode</Label>
              <Input
                id="branch-kiosk-passcode"
                type="password"
                value={kioskPasscode}
                onChange={(e) => setKioskPasscode(e.target.value)}
                placeholder={isEdit && branch?.has_kiosk_passcode ? '•••••• (set — leave blank to keep)' : 'Set a passcode to enable the kiosk'}
                autoComplete="new-password"
                minLength={4}
                maxLength={60}
              />
              <p className="text-xs font-medium text-muted-foreground">
                Staff enter this once on the tablet to start the guest intake kiosk
                (<span className="font-mono">/kiosk</span>) for this branch. Min 4 characters.
                {isEdit ? ' Leave blank to keep the current passcode.' : ''}
              </p>
            </div>

            <div className="flex flex-col gap-2">
              <Label className="font-semibold">Commission Policy</Label>
              <Select items={policyOptions} value={policyId} onValueChange={(v) => v && setPolicyId(v)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {policyOptions.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
                </SelectContent>
              </Select>
              <p className="text-xs font-medium text-muted-foreground">
                First-session warm-up rule for this branch&apos;s commission. None = full class rate every session.
              </p>
            </div>

            {commissionClasses.length > 0 && (
              <div className="flex flex-col gap-2">
                <Label className="font-semibold">Commission rates (per class)</Label>
                <div className="flex flex-col gap-2 rounded-lg border border-border p-2">
                  {commissionClasses.map((c) => (
                    <div key={c.id} className="grid grid-cols-[1fr_auto] items-center gap-2">
                      <span className="text-sm font-semibold">{c.class_code} <span className="font-medium text-muted-foreground">{c.name}</span></span>
                      <div className="flex items-center gap-1">
                        <Input
                          type="number" min="0" max="100"
                          value={rates[c.id] ?? ''}
                          onChange={(e) => setRate(c.id, e.target.value)}
                          placeholder={String(Math.round(c.commission_rate * 100))}
                          className="w-24 text-right"
                        />
                        <span className="text-sm font-semibold text-muted-foreground">%</span>
                      </div>
                    </div>
                  ))}
                </div>
                <p className="text-xs font-medium text-muted-foreground">
                  This branch&apos;s own rate per class. Blank = use the global Commission Class rate (shown as placeholder).
                </p>
              </div>
            )}
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="ghost"
              onClick={() => setOpen(false)}
              disabled={pending}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={pending}>
              {pending ? 'Saving…' : isEdit ? 'Save changes' : 'Create branch'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
