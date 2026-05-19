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

import { createResource, updateResource } from '@/app/(dashboard)/settings/resources/actions';

export type ResourceType = 'massage_bed' | 'rest_room' | 'hair_chair' | 'nail_table' | 'steam_room';

export interface ResourceItem {
  id: string;
  branch_id: string;
  resource_type: ResourceType;
  resource_name: string;
  location_zone: string | null;
  capacity: number;
  business_unit_id: string | null;
}

interface BranchOption {
  id: string;
  code: string;
  name: string;
}

interface BusinessUnitOption {
  id: string;
  code: string;
  name: string;
}

interface Props {
  mode?: 'create' | 'edit';
  resource?: ResourceItem;
  branches: BranchOption[];
  businessUnits: BusinessUnitOption[];
  trigger?: React.ReactNode;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}

const RESOURCE_TYPES: { value: ResourceType; label: string }[] = [
  { value: 'massage_bed', label: 'Massage Bed' },
  { value: 'rest_room', label: 'Rest Room' },
  { value: 'hair_chair', label: 'Hair Chair' },
  { value: 'nail_table', label: 'Nail Table' },
  { value: 'steam_room', label: 'Steam Room' },
];

export function ResourceFormDialog({
  mode = 'create',
  resource,
  branches,
  businessUnits,
  trigger,
  open: controlledOpen,
  onOpenChange: controlledOnOpenChange,
}: Props) {
  const [internalOpen, setInternalOpen] = useState(false);
  const open = controlledOpen ?? internalOpen;
  const setOpen = controlledOnOpenChange ?? setInternalOpen;
  const [pending, startTransition] = useTransition();

  const [branchId, setBranchId] = useState(resource?.branch_id ?? branches[0]?.id ?? '');
  const [resourceType, setResourceType] = useState<ResourceType>(resource?.resource_type ?? 'massage_bed');
  const [resourceName, setResourceName] = useState(resource?.resource_name ?? '');
  const [locationZone, setLocationZone] = useState(resource?.location_zone ?? '');
  const [capacity, setCapacity] = useState(String(resource?.capacity ?? 1));
  const [businessUnitId, setBusinessUnitId] = useState(resource?.business_unit_id ?? businessUnits[0]?.id ?? '');

  const branchOptions = branches.map((b) => ({ value: b.id, label: `${b.code} — ${b.name}` }));
  const businessUnitOptions = businessUnits.map((b) => ({ value: b.id, label: `${b.code} — ${b.name}` }));

  const isEdit = mode === 'edit';

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const payload = {
      branch_id: branchId,
      resource_type: resourceType,
      resource_name: resourceName,
      location_zone: locationZone || null,
      capacity: Number(capacity),
      business_unit_id: businessUnitId || null,
    };
    startTransition(async () => {
      const r = isEdit
        ? await updateResource({ id: resource!.id, ...payload })
        : await createResource(payload);
      if (r.ok) {
        toast.success(isEdit ? 'Service station updated' : 'Service station created');
        setOpen(false);
        if (!isEdit) {
          setResourceName('');
          setLocationZone('');
          setCapacity('1');
        }
      } else {
        toast.error(r.error);
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
              {isEdit ? `Edit Service Station: ${resource?.resource_name}` : 'New Service Station'}
            </DialogTitle>
            <DialogDescription className="font-medium">
              Physical spot where a service is performed — bed, chair, table, or room.
            </DialogDescription>
          </DialogHeader>

          <div className="flex flex-col gap-4 py-4">
            <div className="flex flex-col gap-2">
              <Label className="font-semibold">Branch *</Label>
              <Select items={branchOptions} value={branchId} onValueChange={(v) => v && setBranchId(v)}>
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
              <Select items={businessUnitOptions} value={businessUnitId} onValueChange={(v) => v && setBusinessUnitId(v)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {businessUnitOptions.map((opt) => (
                    <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="flex flex-col gap-2">
              <Label className="font-semibold">Type *</Label>
              <Select value={resourceType} onValueChange={(v) => v && setResourceType(v as ResourceType)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {RESOURCE_TYPES.map((t) => (
                    <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="flex flex-col gap-2">
              <Label htmlFor="r-name" className="font-semibold">Name *</Label>
              <Input
                id="r-name"
                value={resourceName}
                onChange={(e) => setResourceName(e.target.value)}
                placeholder="Bed #1 / Rest Room A"
                required
                maxLength={80}
              />
            </div>

            <div className="flex flex-col gap-2">
              <Label htmlFor="r-zone" className="font-semibold">Location Zone</Label>
              <Input
                id="r-zone"
                value={locationZone}
                onChange={(e) => setLocationZone(e.target.value)}
                placeholder="OSP2-2F"
                maxLength={40}
              />
            </div>

            <div className="flex flex-col gap-2">
              <Label htmlFor="r-cap" className="font-semibold">Capacity *</Label>
              <Input
                id="r-cap"
                type="number"
                min="1"
                max="20"
                value={capacity}
                onChange={(e) => setCapacity(e.target.value)}
                required
              />
              <p className="text-xs font-medium text-muted-foreground">
                Number of guests this resource can serve simultaneously. Most rooms = 1.
              </p>
            </div>
          </div>

          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => setOpen(false)} disabled={pending}>
              Cancel
            </Button>
            <Button type="submit" disabled={pending}>
              {pending ? 'Saving…' : isEdit ? 'Save changes' : 'Create resource'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
