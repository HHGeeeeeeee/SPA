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
import { Textarea } from '@/components/ui/textarea';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

import { createSetting, updateSetting } from '@/app/(dashboard)/settings/system/actions';

export interface SettingItem {
  id: string;
  key: string;
  value: string;
  value_type: 'string' | 'integer' | 'decimal' | 'boolean';
  description: string | null;
  scope: 'global' | 'branch';
  branch_id: string | null;
}

interface BranchOption {
  id: string;
  code: string;
  name: string;
}

interface Props {
  mode?: 'create' | 'edit';
  setting?: SettingItem;
  branches: BranchOption[];
  trigger?: React.ReactNode;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}

const NONE = '__none__';

export function SettingFormDialog({
  mode = 'create',
  setting,
  branches,
  trigger,
  open: controlledOpen,
  onOpenChange: controlledOnOpenChange,
}: Props) {
  const [internalOpen, setInternalOpen] = useState(false);
  const open = controlledOpen ?? internalOpen;
  const setOpen = controlledOnOpenChange ?? setInternalOpen;
  const [pending, startTransition] = useTransition();
  const isEdit = mode === 'edit';

  const [key, setKey] = useState(setting?.key ?? '');
  const [value, setValue] = useState(setting?.value ?? '');
  const [valueType, setValueType] = useState<SettingItem['value_type']>(setting?.value_type ?? 'string');
  const [description, setDescription] = useState(setting?.description ?? '');
  const [scope, setScope] = useState<SettingItem['scope']>(setting?.scope ?? 'global');
  const [branchId, setBranchId] = useState(setting?.branch_id ?? NONE);

  const branchOptions = branches.map((b) => ({ value: b.id, label: `${b.code} — ${b.name}` }));

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    startTransition(async () => {
      const r = isEdit
        ? await updateSetting({ id: setting!.id, value, description })
        : await createSetting({
            key,
            value,
            value_type: valueType,
            description,
            scope,
            branch_id: scope === 'branch' && branchId !== NONE ? branchId : null,
          });
      if (r.ok) {
        toast.success(isEdit ? 'Setting updated' : 'Setting created');
        setOpen(false);
        if (!isEdit) {
          setKey('');
          setValue('');
          setDescription('');
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
      <DialogContent className="sm:max-w-lg">
        <form onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle className="font-bold">
              {isEdit ? `Edit Setting: ${setting?.key}` : 'New System Setting'}
            </DialogTitle>
            <DialogDescription className="font-medium">
              {isEdit
                ? 'Key, type, scope are immutable. You can update value + description.'
                : 'Add a runtime-tunable parameter (a "magic number").'}
            </DialogDescription>
          </DialogHeader>

          <div className="flex flex-col gap-4 py-4">
            <div className="flex flex-col gap-2">
              <Label htmlFor="set-key" className="font-semibold">Key *</Label>
              <Input
                id="set-key"
                value={key}
                onChange={(e) => setKey(e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, ''))}
                placeholder="manager_max_discount_percent"
                disabled={isEdit}
                required
                maxLength={80}
              />
              <p className="text-xs font-medium text-muted-foreground">
                Lowercase + underscores. Used by code, do not change semantically.
              </p>
            </div>

            {!isEdit && (
              <div className="flex flex-col gap-2">
                <Label className="font-semibold">Value Type *</Label>
                <Select items={[{ value: 'string', label: 'String' }, { value: 'integer', label: 'Integer' }, { value: 'decimal', label: 'Decimal' }, { value: 'boolean', label: 'Boolean' }]} value={valueType} onValueChange={(v) => v && setValueType(v as SettingItem['value_type'])}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="string">String</SelectItem>
                    <SelectItem value="integer">Integer</SelectItem>
                    <SelectItem value="decimal">Decimal</SelectItem>
                    <SelectItem value="boolean">Boolean</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            )}

            <div className="flex flex-col gap-2">
              <Label htmlFor="set-value" className="font-semibold">Value *</Label>
              {valueType === 'boolean' ? (
                <Select items={[{ value: 'true', label: 'true' }, { value: 'false', label: 'false' }]} value={value} onValueChange={(v) => v && setValue(v)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="true">true</SelectItem>
                    <SelectItem value="false">false</SelectItem>
                  </SelectContent>
                </Select>
              ) : (
                <Input
                  id="set-value"
                  value={value}
                  onChange={(e) => setValue(e.target.value)}
                  required
                  inputMode={valueType === 'integer' || valueType === 'decimal' ? 'numeric' : 'text'}
                />
              )}
            </div>

            <div className="flex flex-col gap-2">
              <Label htmlFor="set-desc" className="font-semibold">Description</Label>
              <Textarea
                id="set-desc"
                value={description ?? ''}
                onChange={(e) => setDescription(e.target.value)}
                rows={2}
                placeholder="What does this setting control?"
              />
            </div>

            {!isEdit && (
              <>
                <div className="flex flex-col gap-2">
                  <Label className="font-semibold">Scope *</Label>
                  <Select items={[{ value: 'global', label: 'Global' }, { value: 'branch', label: 'Per Branch' }]} value={scope} onValueChange={(v) => v && setScope(v as SettingItem['scope'])}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="global">Global</SelectItem>
                      <SelectItem value="branch">Per Branch</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                {scope === 'branch' && (
                  <div className="flex flex-col gap-2">
                    <Label className="font-semibold">Branch *</Label>
                    <Select items={branchOptions} value={branchId ?? NONE} onValueChange={(v) => setBranchId(v ?? NONE)}>
                      <SelectTrigger><SelectValue placeholder="Select branch" /></SelectTrigger>
                      <SelectContent>
                        {branchOptions.map((opt) => (
                          <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                )}
              </>
            )}
          </div>

          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => setOpen(false)} disabled={pending}>
              Cancel
            </Button>
            <Button type="submit" disabled={pending}>
              {pending ? 'Saving…' : isEdit ? 'Save changes' : 'Create'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
