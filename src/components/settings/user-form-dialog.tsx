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
import { Switch } from '@/components/ui/switch';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

import { createStaffUser, updateStaffUser } from '@/app/(dashboard)/settings/users/actions';

export type UserRole = 'admin' | 'manager' | 'accountant' | 'staff' | 'viewer' | 'external_booker';

export interface StaffUserItem {
  id: string;
  email: string;
  acumatica_user_id: string;
  display_name: string | null;
  role: UserRole;
  home_branch_id: string | null;
  branch_ids: string[];
  active: boolean;
}

interface BranchOption {
  id: string;
  code: string;
  name: string;
}

interface Props {
  mode?: 'create' | 'edit';
  user?: StaffUserItem;
  branches: BranchOption[];
  trigger?: React.ReactNode;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}

const NONE = '__none__';

export function UserFormDialog({
  mode = 'create',
  user,
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

  const [acumaticaUserId, setAcumaticaUserId] = useState(user?.acumatica_user_id ?? '');
  const [displayName, setDisplayName] = useState(user?.display_name ?? '');
  const [role, setRole] = useState<UserRole>(user?.role ?? 'staff');
  const [homeBranchId, setHomeBranchId] = useState(user?.home_branch_id ?? NONE);
  const [branchIds, setBranchIds] = useState<string[]>(user?.branch_ids ?? []);
  const [active, setActive] = useState(user?.active ?? false);

  const branchOptions = [
    { value: NONE, label: 'None' },
    ...branches.map((b) => ({ value: b.id, label: `${b.code} — ${b.name}` })),
  ];

  function toggleBranch(id: string) {
    setBranchIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
    );
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    // Home branch is always part of the accessible set.
    const finalBranchIds =
      homeBranchId !== NONE && !branchIds.includes(homeBranchId)
        ? [...branchIds, homeBranchId]
        : branchIds;
    const payload = {
      acumatica_user_id: acumaticaUserId,
      display_name: displayName,
      role,
      home_branch_id: homeBranchId === NONE ? null : homeBranchId,
      branch_ids: finalBranchIds,
      active,
    };
    startTransition(async () => {
      const r = isEdit
        ? await updateStaffUser({ id: user!.id, ...payload })
        : await createStaffUser(payload);
      if (r.ok) {
        toast.success(isEdit ? 'User updated' : 'User invited');
        setOpen(false);
        if (!isEdit) {
          setAcumaticaUserId('');
          setDisplayName('');
          setRole('staff');
          setHomeBranchId(NONE);
          setBranchIds([]);
          setActive(false);
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
              {isEdit ? `Edit User: ${user?.acumatica_user_id}` : 'Invite New User'}
            </DialogTitle>
            <DialogDescription className="font-medium">
              {isEdit
                ? 'Acumatica username and email are immutable. Role + branch + active toggle live below.'
                : 'Provision a staff account. They will be wired to Auth on first Acumatica login.'}
            </DialogDescription>
          </DialogHeader>

          <div className="flex flex-col gap-4 py-4">
            <div className="flex flex-col gap-2">
              <Label htmlFor="u-aid" className="font-semibold">Acumatica Username *</Label>
              <Input
                id="u-aid"
                value={acumaticaUserId}
                onChange={(e) => setAcumaticaUserId(e.target.value)}
                placeholder="jenny"
                disabled={isEdit}
                required
                maxLength={40}
              />
              {!isEdit && (
                <p className="text-xs font-medium text-muted-foreground">
                  Email will be auto-generated as{' '}
                  <span className="font-mono">{(acumaticaUserId || 'username').toLowerCase()}@acumatica.local</span>
                </p>
              )}
            </div>

            <div className="flex flex-col gap-2">
              <Label htmlFor="u-name" className="font-semibold">Display Name</Label>
              <Input
                id="u-name"
                value={displayName ?? ''}
                onChange={(e) => setDisplayName(e.target.value)}
                placeholder="Jenny Tan"
                maxLength={80}
              />
            </div>

            <div className="flex flex-col gap-2">
              <Label className="font-semibold">Role *</Label>
              <Select items={[{ value: 'admin', label: 'Admin — full access' }, { value: 'manager', label: 'Manager — store ops + approvals' }, { value: 'accountant', label: 'Accountant — financial master data' }, { value: 'staff', label: 'Staff — daily POS work' }, { value: 'viewer', label: 'Viewer — read-only' }, { value: 'external_booker', label: 'External Booker — Hotel front-desk reservation only' }]} value={role} onValueChange={(v) => v && setRole(v as UserRole)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="admin">Admin — full access</SelectItem>
                  <SelectItem value="manager">Manager — store ops + approvals</SelectItem>
                  <SelectItem value="accountant">Accountant — financial master data</SelectItem>
                  <SelectItem value="staff">Staff — daily POS work</SelectItem>
                  <SelectItem value="viewer">Viewer — read-only</SelectItem>
                  <SelectItem value="external_booker">External Booker — Hotel front-desk reservation only</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="flex flex-col gap-2">
              <Label className="font-semibold">Home Branch</Label>
              <Select items={branchOptions} value={homeBranchId ?? NONE} onValueChange={(v) => setHomeBranchId(v ?? NONE)}>
                <SelectTrigger><SelectValue placeholder="None" /></SelectTrigger>
                <SelectContent>
                  {branchOptions.map((opt) => (
                    <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs font-medium text-muted-foreground">
                Primary / default branch shown on login and pre-filled on new orders.
              </p>
            </div>

            <div className="flex flex-col gap-2">
              <Label className="font-semibold">Accessible Branches</Label>
              <div className="flex flex-col gap-1 rounded-lg border border-input p-2">
                {branches.length === 0 ? (
                  <p className="text-xs font-medium text-muted-foreground px-2 py-1">
                    No branches defined yet.
                  </p>
                ) : (
                  branches.map((b) => {
                    const isHome = b.id === homeBranchId;
                    return (
                      <label
                        key={b.id}
                        className="flex items-center gap-2 cursor-pointer rounded-md px-2 py-1.5 hover:bg-accent"
                      >
                        <input
                          type="checkbox"
                          className="size-4 cursor-pointer accent-primary disabled:opacity-60"
                          checked={branchIds.includes(b.id) || isHome}
                          disabled={isHome}
                          onChange={() => toggleBranch(b.id)}
                        />
                        <span className="text-sm font-semibold">{b.code} — {b.name}</span>
                        {isHome && (
                          <span className="text-[10px] font-bold uppercase tracking-wide text-primary">Home</span>
                        )}
                      </label>
                    );
                  })
                )}
              </div>
              <p className="text-xs font-medium text-muted-foreground">
                Every branch this user can manage. Home branch is always included. A
                multi-store manager can be given more than one.
              </p>
            </div>

            <div className="flex items-center justify-between rounded-lg border border-border px-3 py-2">
              <div>
                <Label className="font-semibold cursor-pointer">Active</Label>
                <p className="text-xs font-medium text-muted-foreground">
                  New users are inactive until admin enables them
                </p>
              </div>
              <Switch checked={active} onCheckedChange={setActive} />
            </div>
          </div>

          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => setOpen(false)} disabled={pending}>
              Cancel
            </Button>
            <Button type="submit" disabled={pending}>
              {pending ? 'Saving…' : isEdit ? 'Save changes' : 'Invite User'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
