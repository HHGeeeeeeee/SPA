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
  therapistId: string; // NONE = unassigned
  resourceId: string; // NONE = none
  discountId: string;
  discountOverride: string;
}

interface ServiceVariant { id: string; name: string; group: string; duration_minutes: number; price_cents: number | null; required_resource_type: string | null }
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
  const neededType = (svcSelected ?? groupRep)?.required_resource_type ?? null;
  const eligibleResources = neededType ? resources.filter((r) => r.resource_type === neededType) : resources;
  const resGroups = new Map<string, ResourceOpt[]>();
  for (const r of eligibleResources) {
    const k = r.resource_type ?? '__untyped__';
    if (!resGroups.has(k)) resGroups.set(k, []);
    resGroups.get(k)!.push(r);
  }
  const resLabel = (r: ResourceOpt) => `${r.name}${busyRes.has(r.id) ? ' · in use' : ''}`;
  const resItems = [{ value: NONE, label: 'None' }, ...eligibleResources.map((r) => ({ value: r.id, label: resLabel(r) }))];

  const discRate = (d: DiscountOpt): string | null =>
    d.discount_percent > 0 ? `${d.discount_percent}%` : d.discount_amount_cents > 0 ? `${(d.discount_amount_cents / 100).toLocaleString()}` : null;
  const discOptions = discountClasses.map((d) => {
    const rate = discRate(d);
    return { value: d.id, label: rate ? `${d.code} — ${rate} — ${d.description}` : `${d.code} — ${d.description}` };
  });
  const selectedDiscountCode = discountClasses.find((d) => d.id === draft.discountId)?.code ?? '';
  const needsDiscountAmount = ['DIS-91', 'DIS-99'].includes(selectedDiscountCode);

  // Switching the service group can invalidate the therapist (skill) and the
  // station (required type) — drop those so the operator re-picks a valid one.
  const changeGroup = (v: string | null) => {
    if (!v) return;
    const patch: Partial<LineDraft> = { groupSel: v, svcId: '', therapistId: NONE };
    if (draft.resourceId !== NONE) {
      const newType = serviceItems.find((s) => s.group === v)?.required_resource_type ?? null;
      const cur = resources.find((r) => r.id === draft.resourceId);
      if (newType && cur && cur.resource_type !== newType) patch.resourceId = NONE;
    }
    onChange(patch);
  };
  const changeSvc = (v: string | null) => {
    if (!v) return;
    const patch: Partial<LineDraft> = { svcId: v };
    if (draft.resourceId !== NONE) {
      const need = serviceItems.find((s) => s.id === v)?.required_resource_type ?? null;
      const cur = resources.find((r) => r.id === draft.resourceId);
      if (need && cur && cur.resource_type !== need) patch.resourceId = NONE;
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
        <Select items={resItems} value={draft.resourceId} onValueChange={(v) => onChange({ resourceId: v ?? NONE })} disabled={disabled}>
          <SelectTrigger className="h-8 w-full"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value={NONE}>None</SelectItem>
            {eligibleResources.length === 0 ? (
              <SelectItem value="__nomatch__" disabled>{neededType ? `No ${RESOURCE_TYPE_LABEL[neededType] ?? neededType} here` : 'No stations'}</SelectItem>
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
      </div>
      <div className="min-w-0">
        <Select items={discOptions} value={sourceDiscountLocked ? defaultDiscountId : draft.discountId} onValueChange={(v) => v && onChange({ discountId: v })} disabled={disabled || sourceDiscountLocked}>
          <SelectTrigger className="h-8 w-full"><SelectValue /></SelectTrigger>
          <SelectContent>{discOptions.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}</SelectContent>
        </Select>
        {needsDiscountAmount && (
          <Input className="h-7 mt-1" type="number" min="0" step="0.01" value={draft.discountOverride} onChange={(e) => onChange({ discountOverride: e.target.value })} placeholder={`${selectedDiscountCode} amt`} disabled={disabled} />
        )}
      </div>
    </>
  );
}
