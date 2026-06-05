'use client';

import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { canPerformGroup, matchesGender } from '@/lib/therapist-availability';
import { RESOURCE_TYPE_LABEL } from '@/lib/resource-types';

const NONE = '__none__';
const money0 = (cents: number | null) => (cents == null ? '—' : (cents / 100).toLocaleString('en-PH'));

// One not-yet-started service line's editable fields. Held by the parent (one
// draft per line); price is derived server-side on save, never edited here.
export interface LineDraft {
  groupSel: string;
  svcId: string;
  start: string; // HH:mm booked start, '' = none
  therapistId: string; // NONE = unassigned
  resourceId: string; // NONE = none
  roomNo: string; // dispatch room no
  discountId: string;
  discountOverride: string;
}

interface ServiceVariant { id: string; name: string; group: string; duration_minutes: number; price_cents: number | null; allowed_resource_types: string[] }
interface ResourceOpt { id: string; name: string; resource_type: string | null }
interface DiscountOpt { id: string; code: string; description: string; discount_percent: number; discount_amount_cents: number }
interface Emp { id: string; code: string; name: string; gender?: string | null; visiting?: boolean }
interface BorrowEmp { id: string; code: string; name: string; gender?: string | null; homeBranchCode: string | null }

// Inline editor for one service line — the same smart-filtered pickers the Add
// Service form uses (duration by service, therapist by skill/gender/busy, station
// by required type/busy), but bound to this line's draft so every editable line
// is open at once. Returns just the field controls; the parent renders the
// line's actions + (read-only) amount alongside.
export function ServiceLineEditor({
  draft,
  onChange,
  serviceItems,
  employees,
  borrowableEmployees,
  resources,
  discountClasses,
  capabilityByEmployee,
  busyTherapistIds,
  busyResourceIds,
  guestGender,
  sourceDiscountLocked,
  defaultDiscountId,
  disabled,
  dispatch,
}: {
  draft: LineDraft;
  onChange: (patch: Partial<LineDraft>) => void;
  serviceItems: ServiceVariant[];
  employees: Emp[];
  borrowableEmployees: BorrowEmp[];
  resources: ResourceOpt[];
  discountClasses: DiscountOpt[];
  capabilityByEmployee: Record<string, string[]>;
  busyTherapistIds: string[];
  busyResourceIds: string[];
  guestGender: string;
  sourceDiscountLocked: boolean;
  defaultDiscountId: string;
  disabled?: boolean;
  dispatch?: boolean;
}) {
  const groupOptions = [...new Set(serviceItems.map((s) => s.group))].sort().map((g) => ({ value: g, label: g }));
  const variantOptions = serviceItems
    .filter((s) => s.group === draft.groupSel)
    .map((s) => ({ value: s.id, label: `${s.duration_minutes} min · ${money0(s.price_cents)}` }));

  const busy = new Set(busyTherapistIds);
  const canDoGroup = (id: string) => canPerformGroup(capabilityByEmployee[id] ?? [], draft.groupSel || null);
  const genderOf = new Map<string, string | null>([...employees, ...borrowableEmployees].map((e) => [e.id, e.gender ?? null]));
  const matchGender = (id: string) => matchesGender(genderOf.get(id), guestGender);
  const thisBranchOptions = employees
    .filter((e) => canDoGroup(e.id) && matchGender(e.id))
    .map((e) => ({ value: e.id, label: `${e.code} — ${e.name}${busy.has(e.id) ? ' · in service' : ''}`, disabled: busy.has(e.id) }));
  const borrowOptions = borrowableEmployees
    .filter((e) => canDoGroup(e.id) && matchGender(e.id))
    .map((e) => ({ value: e.id, label: `${e.code} — ${e.name}${e.homeBranchCode ? ` · ${e.homeBranchCode}` : ''}${busy.has(e.id) ? ' · in service' : ''}`, disabled: busy.has(e.id) }));
  const empItems = [{ value: NONE, label: 'Unassigned' }, ...thisBranchOptions, ...borrowOptions];

  const busyRes = new Set(busyResourceIds);
  const svcSelected = serviceItems.find((s) => s.id === draft.svcId);
  const groupRep = !svcSelected && draft.groupSel ? serviceItems.find((s) => s.group === draft.groupSel) : null;
  const neededTypes = (svcSelected ?? groupRep)?.allowed_resource_types ?? [];
  const eligibleResources = neededTypes.length
    ? resources.filter((r) => r.resource_type != null && neededTypes.includes(r.resource_type))
    : resources;
  const resGroups = new Map<string, ResourceOpt[]>();
  for (const r of eligibleResources) {
    const k = r.resource_type ?? '__untyped__';
    if (!resGroups.has(k)) resGroups.set(k, []);
    resGroups.get(k)!.push(r);
  }
  const resLabel = (r: ResourceOpt) => `${r.name}${busyRes.has(r.id) ? ' · in use' : ''}`;
  const resItems = [{ value: NONE, label: 'None' }, ...eligibleResources.map((r) => ({ value: r.id, label: resLabel(r) }))];

  const discOptions = discountClasses.map((d) => ({ value: d.id, label: d.description }));
  const effectiveDiscountId = sourceDiscountLocked ? defaultDiscountId : draft.discountId;
  const selectedDiscount = discountClasses.find((d) => d.id === effectiveDiscountId);
  const needsDiscountAmount = ['DIS-91', 'DIS-99'].includes(selectedDiscount?.code ?? '');
  // Live preview shown alongside the pickers: the chosen variant's list price, and
  // the discount value (rate for percent classes, peso amount for fixed classes).
  const priceLabel = svcSelected?.price_cents != null ? money0(svcSelected.price_cents) : '—';
  const discValueLabel = !selectedDiscount
    ? '—'
    : selectedDiscount.discount_percent > 0 ? `-${selectedDiscount.discount_percent}%`
    : selectedDiscount.discount_amount_cents > 0 ? `-${money0(selectedDiscount.discount_amount_cents)}`
    : '—';

  // Switching the service group can invalidate the therapist (skill) and the
  // station (required type) — drop those so the operator re-picks a valid one.
  const changeGroup = (v: string | null) => {
    if (!v) return;
    const patch: Partial<LineDraft> = { groupSel: v, svcId: '', therapistId: NONE };
    if (draft.resourceId !== NONE) {
      const newTypes = serviceItems.find((s) => s.group === v)?.allowed_resource_types ?? [];
      const cur = resources.find((r) => r.id === draft.resourceId);
      if (newTypes.length && cur && (cur.resource_type == null || !newTypes.includes(cur.resource_type))) patch.resourceId = NONE;
    }
    onChange(patch);
  };
  const changeSvc = (v: string | null) => {
    if (!v) return;
    const patch: Partial<LineDraft> = { svcId: v };
    if (draft.resourceId !== NONE) {
      const need = serviceItems.find((s) => s.id === v)?.allowed_resource_types ?? [];
      const cur = resources.find((r) => r.id === draft.resourceId);
      if (need.length && cur && (cur.resource_type == null || !need.includes(cur.resource_type))) patch.resourceId = NONE;
    }
    onChange(patch);
  };

  // Bare cells (no per-field labels) so the row aligns under the shared column
  // headers — each is a grid item placed by the parent's SERVICE_GRID template.
  return (
    <>
      <div className="min-w-0">
        <Select items={groupOptions} value={draft.groupSel} onValueChange={changeGroup} disabled={disabled}>
          <SelectTrigger className="h-8 w-full"><SelectValue placeholder="Service" /></SelectTrigger>
          <SelectContent>{groupOptions.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}</SelectContent>
        </Select>
      </div>
      <div className="min-w-0">
        <Select items={variantOptions} value={draft.svcId} onValueChange={changeSvc} disabled={disabled || !draft.groupSel}>
          <SelectTrigger className="h-8 w-full"><SelectValue placeholder={draft.groupSel ? 'Duration' : '—'} /></SelectTrigger>
          <SelectContent>{variantOptions.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}</SelectContent>
        </Select>
      </div>
      <div className="min-w-0">
        <Input type="time" className="h-8 w-full" value={draft.start} onChange={(e) => onChange({ start: e.target.value })} disabled={disabled} />
      </div>
      <div className="min-w-0">
        <Select items={empItems} value={draft.therapistId} onValueChange={(v) => onChange({ therapistId: v ?? NONE })} disabled={disabled}>
          <SelectTrigger className="h-8 w-full"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value={NONE}>Unassigned</SelectItem>
            <SelectGroup>
              <SelectLabel>At this branch</SelectLabel>
              {thisBranchOptions.length === 0 ? (
                <SelectItem value="__nobody__" disabled>{draft.groupSel ? `No therapist here can do ${draft.groupSel}` : 'No therapist rostered here'}</SelectItem>
              ) : (
                thisBranchOptions.map((o) => <SelectItem key={o.value} value={o.value} disabled={o.disabled}>{o.label}</SelectItem>)
              )}
            </SelectGroup>
            {borrowOptions.length > 0 && (
              <>
                <SelectSeparator />
                <SelectGroup>
                  <SelectLabel>Borrow from other branch</SelectLabel>
                  {borrowOptions.map((o) => <SelectItem key={o.value} value={o.value} disabled={o.disabled}>{o.label}</SelectItem>)}
                </SelectGroup>
              </>
            )}
          </SelectContent>
        </Select>
      </div>
      <div className="min-w-0">
        {dispatch ? (
          <Input type="text" className="h-8 w-full" value={draft.roomNo} onChange={(e) => onChange({ roomNo: e.target.value })} placeholder="Room no" disabled={disabled} />
        ) : (
        <Select items={resItems} value={draft.resourceId} onValueChange={(v) => onChange({ resourceId: v ?? NONE })} disabled={disabled}>
          <SelectTrigger className="h-8 w-full"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value={NONE}>None</SelectItem>
            {eligibleResources.length === 0 ? (
              <SelectItem value="__nomatch__" disabled>{neededTypes.length ? `No ${neededTypes.map((t) => RESOURCE_TYPE_LABEL[t] ?? t).join(' / ')} here` : 'No stations'}</SelectItem>
            ) : (
              [...resGroups.entries()].map(([type, list]) => (
                <SelectGroup key={type}>
                  <SelectLabel>{RESOURCE_TYPE_LABEL[type] ?? type}</SelectLabel>
                  {list.map((r) => <SelectItem key={r.id} value={r.id} disabled={busyRes.has(r.id)}>{resLabel(r)}</SelectItem>)}
                </SelectGroup>
              ))
            )}
          </SelectContent>
        </Select>
        )}
      </div>
      {/* Price — list price of the chosen variant, previewed live before save. */}
      <span className="text-right tabular text-sm font-medium text-muted-foreground">{priceLabel}</span>
      <div className="min-w-0">
        <Select items={discOptions} value={effectiveDiscountId} onValueChange={(v) => v && onChange({ discountId: v })} disabled={disabled || sourceDiscountLocked}>
          <SelectTrigger className="h-8 w-full"><SelectValue /></SelectTrigger>
          <SelectContent>{discOptions.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}</SelectContent>
        </Select>
      </div>
      {/* Disc. — manual classes get an inline amount input here (own column, no wrap); others show the value. */}
      <div className="min-w-0">
        {needsDiscountAmount ? (
          <Input className="h-8 w-full text-right" type="number" min="0" step="0.01" value={draft.discountOverride} onChange={(e) => onChange({ discountOverride: e.target.value })} placeholder="Amt" disabled={disabled} />
        ) : (
          <span className="block text-xs font-medium text-muted-foreground tabular">{discValueLabel}</span>
        )}
      </div>
    </>
  );
}
