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

import { createEmployee, updateEmployee } from '@/app/(dashboard)/settings/employees/actions';

export interface EmployeeItem {
  id: string;
  employee_code: string;
  name: string;
  phone: string | null;
  email: string | null;
  gender: string | null;
  home_branch_id: string | null;
  commission_class_id: string | null;
  position: string | null;
  status: 'active' | 'inactive' | 'on_leave';
}

interface BranchOption {
  id: string;
  code: string;
  name: string;
}

interface ClassOption {
  id: string;
  class_code: string;
  name: string;
}

interface Props {
  mode?: 'create' | 'edit';
  employee?: EmployeeItem;
  branches: BranchOption[];
  classes: ClassOption[];
  trigger?: React.ReactNode;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}

const NONE = '__none__';

export function EmployeeFormDialog({
  mode = 'create',
  employee,
  branches,
  classes,
  trigger,
  open: controlledOpen,
  onOpenChange: controlledOnOpenChange,
}: Props) {
  const [internalOpen, setInternalOpen] = useState(false);
  const open = controlledOpen ?? internalOpen;
  const setOpen = controlledOnOpenChange ?? setInternalOpen;
  const [pending, startTransition] = useTransition();

  const [employeeCode, setEmployeeCode] = useState(employee?.employee_code ?? '');
  const [name, setName] = useState(employee?.name ?? '');
  const [phone, setPhone] = useState(employee?.phone ?? '');
  const [email, setEmail] = useState(employee?.email ?? '');
  const [gender, setGender] = useState(employee?.gender ?? NONE);
  const [homeBranchId, setHomeBranchId] = useState(employee?.home_branch_id ?? NONE);
  const [classId, setClassId] = useState(employee?.commission_class_id ?? NONE);
  const [position, setPosition] = useState(employee?.position ?? 'Massage Therapist');
  const [status, setStatus] = useState<EmployeeItem['status']>(employee?.status ?? 'active');

  const isEdit = mode === 'edit';

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const payload = {
      employee_code: employeeCode,
      name,
      phone: phone || null,
      email: email || null,
      gender: gender === NONE ? null : gender,
      home_branch_id: homeBranchId === NONE ? null : homeBranchId,
      commission_class_id: classId === NONE ? null : classId,
      position: position || null,
      status,
    };
    startTransition(async () => {
      const r = isEdit
        ? await updateEmployee({ id: employee!.id, ...payload })
        : await createEmployee(payload);
      if (r.ok) {
        toast.success(isEdit ? 'Employee updated' : 'Employee created');
        setOpen(false);
        if (!isEdit) {
          setEmployeeCode('');
          setName('');
          setPhone('');
          setEmail('');
        }
      } else {
        toast.error(r.error);
      }
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      {trigger ? (
        <DialogTrigger nativeButton={false} render={trigger as React.ReactElement} />
      ) : null}
      <DialogContent className="sm:max-w-xl">
        <form onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle className="font-bold">
              {isEdit ? `Edit Employee: ${employee?.employee_code}` : 'New Employee'}
            </DialogTitle>
            <DialogDescription className="font-medium">
              {isEdit ? 'Employee code is immutable.' : 'Add a new therapist or staff member.'}
            </DialogDescription>
          </DialogHeader>

          <div className="grid grid-cols-2 gap-4 py-4">
            <div className="flex flex-col gap-2">
              <Label htmlFor="emp-code" className="font-semibold">Code *</Label>
              <Input
                id="emp-code"
                value={employeeCode}
                onChange={(e) => setEmployeeCode(e.target.value.toUpperCase())}
                placeholder="E001"
                disabled={isEdit}
                required
                maxLength={20}
              />
            </div>

            <div className="flex flex-col gap-2">
              <Label htmlFor="emp-name" className="font-semibold">Name *</Label>
              <Input id="emp-name" value={name} onChange={(e) => setName(e.target.value)} required maxLength={120} />
            </div>

            <div className="flex flex-col gap-2">
              <Label htmlFor="emp-phone" className="font-semibold">Phone</Label>
              <Input id="emp-phone" value={phone} onChange={(e) => setPhone(e.target.value)} maxLength={40} />
            </div>

            <div className="flex flex-col gap-2">
              <Label htmlFor="emp-email" className="font-semibold">Email</Label>
              <Input id="emp-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} maxLength={120} />
            </div>

            <div className="flex flex-col gap-2">
              <Label className="font-semibold">Gender</Label>
              <Select value={gender ?? NONE} onValueChange={(v) => setGender(v ?? NONE)}>
                <SelectTrigger><SelectValue placeholder="—" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE}>—</SelectItem>
                  <SelectItem value="M">Male</SelectItem>
                  <SelectItem value="F">Female</SelectItem>
                  <SelectItem value="Other">Other</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="flex flex-col gap-2">
              <Label className="font-semibold">Status *</Label>
              <Select
                value={status}
                onValueChange={(v) => v && setStatus(v as EmployeeItem['status'])}
              >
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="active">Active</SelectItem>
                  <SelectItem value="inactive">Inactive</SelectItem>
                  <SelectItem value="on_leave">On Leave</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="flex flex-col gap-2">
              <Label className="font-semibold">Home Branch</Label>
              <Select value={homeBranchId ?? NONE} onValueChange={(v) => setHomeBranchId(v ?? NONE)}>
                <SelectTrigger><SelectValue placeholder="None" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE}>None (freelance / cross)</SelectItem>
                  {branches.map((b) => (
                    <SelectItem key={b.id} value={b.id}>
                      {b.code} — {b.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="flex flex-col gap-2">
              <Label className="font-semibold">Commission Class</Label>
              <Select value={classId ?? NONE} onValueChange={(v) => setClassId(v ?? NONE)}>
                <SelectTrigger><SelectValue placeholder="None" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE}>None</SelectItem>
                  {classes.map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.class_code} — {c.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="flex flex-col gap-2 col-span-2">
              <Label htmlFor="emp-position" className="font-semibold">Position</Label>
              <Input
                id="emp-position"
                value={position}
                onChange={(e) => setPosition(e.target.value)}
                maxLength={80}
                placeholder="Massage Therapist"
              />
            </div>
          </div>

          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => setOpen(false)} disabled={pending}>
              Cancel
            </Button>
            <Button type="submit" disabled={pending}>
              {pending ? 'Saving…' : isEdit ? 'Save changes' : 'Create employee'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
