'use client';

import { useState, useTransition } from 'react';
import { Plus, Trash2 } from 'lucide-react';
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
import { Switch } from '@/components/ui/switch';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

import { createCommissionPolicy, updateCommissionPolicy } from '@/app/(dashboard)/settings/commission-policies/actions';

export type PolicyKind = 'warmup' | 'cheapest_free';
export interface PolicyBand { min_minutes: number | null; up_to_minutes: number | null; commission_rate: number }
export interface CommissionPolicyItem {
  id: string;
  code: string;
  name: string;
  kind: PolicyKind;
  free_duration_minutes: number | null;
  warmup_enabled: boolean;
  warmup_occurrence: number;
  bands: PolicyBand[];
}

interface Props {
  mode?: 'create' | 'edit';
  item?: CommissionPolicyItem;
  trigger?: React.ReactNode;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}

interface BandInput { from: string; up: string; pct: string }

export function CommissionPolicyFormDialog({ mode = 'create', item, trigger, open: controlledOpen, onOpenChange: controlledOnOpenChange }: Props) {
  const [internalOpen, setInternalOpen] = useState(false);
  const open = controlledOpen ?? internalOpen;
  const setOpen = controlledOnOpenChange ?? setInternalOpen;
  const isEdit = mode === 'edit';
  const [pending, startTransition] = useTransition();

  const [code, setCode] = useState(item?.code ?? '');
  const [name, setName] = useState(item?.name ?? '');
  const [kind, setKind] = useState<PolicyKind>(item?.kind ?? 'warmup');
  // cheapest_free target duration; '' = any duration competes to be the free one.
  const [freeDuration, setFreeDuration] = useState(item?.free_duration_minutes != null ? String(item.free_duration_minutes) : '60');
  const [warmupEnabled, setWarmupEnabled] = useState(item?.warmup_enabled ?? true);
  const [occurrence, setOccurrence] = useState(String(item?.warmup_occurrence ?? 1));
  const [bands, setBands] = useState<BandInput[]>(
    (item?.bands ?? [
      { min_minutes: null, up_to_minutes: 90, commission_rate: 0 },
      { min_minutes: 120, up_to_minutes: 120, commission_rate: 0.5 },
    ]).map((b) => ({
      from: b.min_minutes == null ? '' : String(b.min_minutes),
      up: b.up_to_minutes == null ? '' : String(b.up_to_minutes),
      pct: String(Math.round(b.commission_rate * 100)),
    })),
  );

  function setBand(i: number, key: keyof BandInput, v: string) {
    setBands((prev) => prev.map((b, idx) => (idx === i ? { ...b, [key]: v } : b)));
  }
  function addBand() { setBands((prev) => [...prev, { from: '', up: '', pct: '0' }]); }
  function removeBand(i: number) { setBands((prev) => prev.filter((_, idx) => idx !== i)); }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const bandPayload = bands.map((b) => ({
      min_minutes: b.from.trim() === '' ? null : Number(b.from),
      up_to_minutes: b.up.trim() === '' ? null : Number(b.up),
      commission_rate: Math.max(0, Math.min(1, (Number(b.pct) || 0) / 100)),
    }));
    const payload = {
      code, name, kind,
      free_duration_minutes: kind === 'cheapest_free' ? (freeDuration.trim() === '' ? null : Number(freeDuration)) : null,
      warmup_enabled: warmupEnabled, warmup_occurrence: Number(occurrence) || 1, bands: bandPayload,
    };
    startTransition(async () => {
      const r = isEdit ? await updateCommissionPolicy({ id: item!.id, ...payload }) : await createCommissionPolicy(payload);
      if (r.ok) {
        toast.success(isEdit ? 'Policy updated' : 'Policy created');
        setOpen(false);
        if (!isEdit) { setCode(''); setName(''); }
      } else toast.error(r.error);
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      {trigger ? <DialogTrigger render={trigger as React.ReactElement} /> : null}
      <DialogContent className="sm:max-w-md">
        <form onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle className="font-bold">{isEdit ? `Edit Policy: ${item?.code}` : 'New Commission Policy'}</DialogTitle>
            <DialogDescription className="font-medium">
              {kind === 'cheapest_free'
                ? 'Cheapest-free rule — each day the therapist’s cheapest qualifying session earns 0%. Every other session uses the class %.'
                : 'First-session warm-up rule — a flat commission rate for the day’s first session (overrides the class %). Other sessions use the class %.'}
            </DialogDescription>
          </DialogHeader>

          <div className="flex flex-col gap-4 py-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="flex flex-col gap-2">
                <Label htmlFor="cpo-code" className="font-semibold">Code *</Label>
                <Input id="cpo-code" value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} placeholder="DEFAULT" disabled={isEdit} required maxLength={40} />
              </div>
              <div className="flex flex-col gap-2">
                <Label htmlFor="cpo-name" className="font-semibold">Name *</Label>
                <Input id="cpo-name" value={name} onChange={(e) => setName(e.target.value)} required maxLength={120} />
              </div>
            </div>

            <div className="flex flex-col gap-2">
              <Label className="font-semibold">Policy type</Label>
              <Select items={[{ value: 'warmup', label: 'Warm-up' }, { value: 'cheapest_free', label: 'Cheapest free' }]} value={kind} onValueChange={(v) => v && setKind(v as PolicyKind)}>
                <SelectTrigger className="font-semibold"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="warmup">Warm-up — day&apos;s Nth session, banded rate</SelectItem>
                  <SelectItem value="cheapest_free">Cheapest free — day&apos;s cheapest qualifying session = 0%</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {kind === 'cheapest_free' && (
              <div className="flex flex-col gap-2">
                <Label htmlFor="cpo-freedur" className="font-semibold">Free session duration (min)</Label>
                <Input id="cpo-freedur" type="number" min="1" value={freeDuration} onChange={(e) => setFreeDuration(e.target.value)} placeholder="any" className="w-32" />
                <p className="text-xs font-medium text-muted-foreground">
                  Only sessions of this length compete; the cheapest one each day is free. Blank = any duration. e.g. 60 → the day&apos;s cheapest 60-min session earns 0%.
                </p>
              </div>
            )}

            {kind === 'warmup' && (
            <div className="flex items-start justify-between gap-3 rounded-lg border border-border p-3">
              <div className="flex flex-col gap-0.5">
                <Label className="font-semibold">Warm-up rule</Label>
                <p className="text-xs font-medium text-muted-foreground">
                  On = the day&apos;s first session gets a reduced rate. Off = every session pays full class rate.
                </p>
              </div>
              <Switch checked={warmupEnabled} onCheckedChange={setWarmupEnabled} />
            </div>
            )}

            {kind === 'warmup' && warmupEnabled && (
              <>
                <div className="flex flex-col gap-2">
                  <Label htmlFor="cpo-occ" className="font-semibold">Applies to session #</Label>
                  <Input id="cpo-occ" type="number" min="1" max="20" value={occurrence} onChange={(e) => setOccurrence(e.target.value)} className="w-24" />
                  <p className="text-xs font-medium text-muted-foreground">Usually 1 (the day&apos;s first commissionable session).</p>
                </div>

                <div className="flex flex-col gap-2">
                  <Label className="font-semibold">Duration bands</Label>
                  <div className="flex flex-col gap-2 rounded-lg border border-border p-2">
                    <div className="grid grid-cols-[1fr_1fr_1fr_auto] gap-2 text-[10px] font-bold uppercase tracking-wide text-muted-foreground px-1">
                      <span>From (min)</span><span>To (min)</span><span>Rate (%)</span><span />
                    </div>
                    {bands.map((b, i) => (
                      <div key={i} className="grid grid-cols-[1fr_1fr_1fr_auto] gap-2 items-center">
                        <Input type="number" min="1" value={b.from} onChange={(e) => setBand(i, 'from', e.target.value)} placeholder="any" />
                        <Input type="number" min="1" value={b.up} onChange={(e) => setBand(i, 'up', e.target.value)} placeholder="any" />
                        <Input type="number" min="0" max="100" value={b.pct} onChange={(e) => setBand(i, 'pct', e.target.value)} placeholder="0–100" />
                        <Button type="button" size="icon-sm" variant="ghost" onClick={() => removeBand(i)}><Trash2 className="size-4 text-destructive" /></Button>
                      </div>
                    ))}
                    <Button type="button" size="sm" variant="outline" onClick={addBand} className="self-start"><Plus className="size-3.5" /> Add band</Button>
                  </div>
                  <p className="text-xs font-medium text-muted-foreground">
                    Match by duration range (From–To inclusive; blank = open). The first session earns this flat rate — not × class. e.g. To 90 → 0%, From 120 To 120 → 50%.
                  </p>
                </div>
              </>
            )}
          </div>

          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => setOpen(false)} disabled={pending}>Cancel</Button>
            <Button type="submit" disabled={pending}>{pending ? 'Saving…' : isEdit ? 'Save changes' : 'Create'}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
