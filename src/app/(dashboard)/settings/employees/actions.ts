'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';

import { createServiceClient } from '@/lib/supabase/server';
import type { Database } from '@/types/database';

type EmployeeUpdate = Database['public']['Tables']['employees']['Update'];

const baseSchema = z.object({
  // Ignored on create — the server auto-assigns a per-branch code.
  employee_code: z.string().max(20).optional().nullable(),
  name: z.string().min(1).max(120),
  phone: z.string().max(40).optional().nullable(),
  email: z.string().email().max(120).optional().nullable().or(z.literal('')),
  gender: z.enum(['M', 'F', 'Other']).optional().nullable(),
  home_branch_id: z.string().uuid().optional().nullable(),
  commission_class_id: z.string().uuid().optional().nullable(),
  position_id: z.string().uuid().optional().nullable(),
  status: z.enum(['active', 'inactive', 'on_leave']).default('active'),
  service_groups: z.array(z.string().min(1).max(80)).optional(),
  // Per-branch commission-class overrides (branch where this therapist has a
  // different class than their default). Branches not listed use the default.
  branch_class_overrides: z.array(z.object({ branch_id: z.string().uuid(), commission_class_id: z.string().uuid() })).optional(),
});

const updateSchema = baseSchema.partial({ employee_code: true }).extend({
  id: z.string().uuid(),
});

export type ActionResult = { ok: true } | { ok: false; error: string };

// Replace an employee's service-group skill set (delete then insert).
async function syncServiceGroups(employeeId: string, groups: string[] | undefined) {
  if (!groups) return null;
  const supabase = createServiceClient();
  const del = await supabase.from('employee_service_groups').delete().eq('employee_id', employeeId);
  if (del.error) return del.error;
  const unique = [...new Set(groups.map((g) => g.trim()).filter(Boolean))];
  if (unique.length === 0) return null;
  const ins = await supabase
    .from('employee_service_groups')
    .insert(unique.map((service_group) => ({ employee_id: employeeId, service_group })));
  return ins.error;
}

// Replace an employee's per-branch class overrides (delete then insert).
async function syncBranchClasses(employeeId: string, overrides: { branch_id: string; commission_class_id: string }[] | undefined) {
  if (!overrides) return null;
  const supabase = createServiceClient();
  const del = await supabase.from('employee_branch_commission_class').delete().eq('employee_id', employeeId);
  if (del.error) return del.error;
  if (overrides.length === 0) return null;
  const ins = await supabase.from('employee_branch_commission_class').insert(
    overrides.map((o) => ({ employee_id: employeeId, branch_id: o.branch_id, commission_class_id: o.commission_class_id })),
  );
  return ins.error;
}

function normalize(input: z.infer<typeof baseSchema>) {
  return {
    name: input.name,
    phone: input.phone || null,
    email: input.email || null,
    gender: input.gender || null,
    home_branch_id: input.home_branch_id || null,
    commission_class_id: input.commission_class_id || null,
    position_id: input.position_id || null,
    status: input.status,
  };
}

// Auto-assign a per-branch code: "{BRANCHCODE}-NNN" (or STAFF-NNN if no home
// branch). Each branch has its own running sequence, so managers never need to
// know another branch's numbering.
export async function nextEmployeeCode(homeBranchId: string | null): Promise<string> {
  const supabase = createServiceClient();
  let prefix = 'STAFF';
  if (homeBranchId) {
    const { data: br } = await supabase.from('branches').select('code').eq('id', homeBranchId).single();
    if (br?.code) prefix = br.code;
  }
  const { data } = await supabase
    .from('employees')
    .select('employee_code')
    .like('employee_code', `${prefix}-%`);
  let max = 0;
  for (const e of data ?? []) {
    const n = Number(e.employee_code.slice(prefix.length + 1));
    if (Number.isFinite(n) && n > max) max = n;
  }
  return `${prefix}-${String(max + 1).padStart(3, '0')}`;
}

export async function createEmployee(input: unknown): Promise<ActionResult> {
  const parsed = baseSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? 'Invalid input' };
  const supabase = createServiceClient();
  const base = normalize(parsed.data);
  // Retry on the off chance two managers grab the same number simultaneously.
  for (let attempt = 0; attempt < 5; attempt++) {
    const employee_code = await nextEmployeeCode(base.home_branch_id);
    const { data, error } = await supabase.from('employees').insert({ ...base, employee_code }).select('id').single();
    if (!error && data) {
      const sgErr = await syncServiceGroups(data.id, parsed.data.service_groups);
      if (sgErr) return { ok: false, error: sgErr.message };
      const bcErr = await syncBranchClasses(data.id, parsed.data.branch_class_overrides);
      if (bcErr) return { ok: false, error: bcErr.message };
      revalidatePath('/settings/employees');
      return { ok: true };
    }
    if (error?.code === '23505') {
      if (/employees_phone_key/.test(error.message)) return { ok: false, error: 'phone already exists' };
      continue; // employee_code collision — recompute and retry
    }
    return { ok: false, error: error?.message ?? 'Insert failed' };
  }
  return { ok: false, error: 'Could not assign an employee code, please retry' };
}

export async function updateEmployee(input: unknown): Promise<ActionResult> {
  const parsed = updateSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? 'Invalid input' };
  const d = parsed.data;
  const patch: EmployeeUpdate = {};
  if (d.name !== undefined) patch.name = d.name;
  if (d.phone !== undefined) patch.phone = d.phone || null;
  if (d.email !== undefined) patch.email = d.email || null;
  if (d.gender !== undefined) patch.gender = d.gender || null;
  if (d.home_branch_id !== undefined) patch.home_branch_id = d.home_branch_id || null;
  if (d.commission_class_id !== undefined) patch.commission_class_id = d.commission_class_id || null;
  if (d.position_id !== undefined) patch.position_id = d.position_id || null;
  if (d.status !== undefined) patch.status = d.status;
  const supabase = createServiceClient();
  if (Object.keys(patch).length > 0) {
    const { error } = await supabase.from('employees').update(patch).eq('id', d.id);
    if (error) {
      if (error.code === '23505') return { ok: false, error: 'phone already exists' };
      return { ok: false, error: error.message };
    }
  }
  const sgErr = await syncServiceGroups(d.id, d.service_groups);
  if (sgErr) return { ok: false, error: sgErr.message };
  const bcErr = await syncBranchClasses(d.id, d.branch_class_overrides);
  if (bcErr) return { ok: false, error: bcErr.message };
  revalidatePath('/settings/employees');
  return { ok: true };
}

export async function setEmployeeStatus(
  id: string,
  status: 'active' | 'inactive' | 'on_leave',
): Promise<ActionResult> {
  const supabase = createServiceClient();
  const { error } = await supabase.from('employees').update({ status }).eq('id', id);
  if (error) return { ok: false, error: error.message };
  revalidatePath('/settings/employees');
  return { ok: true };
}
