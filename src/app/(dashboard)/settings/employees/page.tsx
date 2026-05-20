import Link from 'next/link';
import { ChevronLeft, Plus } from 'lucide-react';

import { createServiceClient } from '@/lib/supabase/server';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Card } from '@/components/ui/card';
import { EmployeeFormDialog, type EmployeeItem } from '@/components/settings/employee-form-dialog';
import { EmployeeRowActions } from '@/components/settings/employee-row-actions';

export const dynamic = 'force-dynamic';

async function fetchData() {
  const supabase = createServiceClient();
  const [empRes, brRes, ccRes, posRes] = await Promise.all([
    supabase
      .from('employees')
      .select(`
        id, employee_code, name, phone, email, gender,
        home_branch_id, commission_class_id, position_id, status, updated_at,
        home_branch:branches!employees_home_branch_id_fkey ( code, name ),
        commission_class:commission_classes ( class_code, name, commission_rate ),
        position:positions ( code, name )
      `)
      .order('employee_code'),
    supabase.from('branches').select('id, code, name').eq('active', true).order('code'),
    supabase.from('commission_classes').select('id, class_code, name').eq('active', true).order('commission_rate', { ascending: false }),
    supabase.from('positions').select('id, code, name').eq('active', true).order('code'),
  ]);
  if (empRes.error) throw new Error(empRes.error.message);
  if (brRes.error) throw new Error(brRes.error.message);
  if (ccRes.error) throw new Error(ccRes.error.message);
  if (posRes.error) throw new Error(posRes.error.message);
  return {
    employees: empRes.data ?? [],
    branches: brRes.data ?? [],
    classes: ccRes.data ?? [],
    positions: posRes.data ?? [],
  };
}

function statusBadge(status: EmployeeItem['status']) {
  if (status === 'active') return <Badge className="font-bold">Active</Badge>;
  if (status === 'on_leave')
    return (
      <Badge variant="secondary" className="font-bold">
        On Leave
      </Badge>
    );
  return (
    <Badge variant="secondary" className="font-bold">
      Inactive
    </Badge>
  );
}

function nextEmployeeCode(codes: string[]): string {
  // Highest E### suffix + 1, padded to 3 digits. Falls back to E001.
  const maxNum = codes.reduce((max, code) => {
    const m = /^E(\d+)$/.exec(code);
    return m ? Math.max(max, Number(m[1])) : max;
  }, 0);
  return `E${String(maxNum + 1).padStart(3, '0')}`;
}

export default async function EmployeesPage() {
  const { employees, branches, classes, positions } = await fetchData();
  const activeCount = employees.filter((e) => e.status === 'active').length;
  const suggestedCode = nextEmployeeCode(employees.map((e) => e.employee_code));

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <Link
            href="/settings"
            className="inline-flex items-center gap-1 text-xs font-semibold text-muted-foreground hover:text-foreground"
          >
            <ChevronLeft className="size-3" />
            Settings
          </Link>
          <h2 className="text-3xl font-bold tracking-tight mt-1">Employees</h2>
          <p className="text-sm font-semibold text-muted-foreground mt-1">
            {employees.length} total · {activeCount} active
          </p>
        </div>
        <EmployeeFormDialog
          branches={branches}
          classes={classes}
          positions={positions}
          suggestedCode={suggestedCode}
          trigger={
            <Button>
              <Plus className="size-4" />
              Add Employee
            </Button>
          }
        />
      </div>

      <Card className="p-0 overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-28 font-bold">Code</TableHead>
              <TableHead className="font-bold">Name</TableHead>
              <TableHead className="font-bold">Phone</TableHead>
              <TableHead className="font-bold">Home Branch</TableHead>
              <TableHead className="font-bold">Class</TableHead>
              <TableHead className="font-bold">Position</TableHead>
              <TableHead className="font-bold">Status</TableHead>
              <TableHead className="w-12" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {employees.length === 0 ? (
              <TableRow>
                <TableCell colSpan={8} className="text-center py-12">
                  <p className="text-sm font-semibold text-muted-foreground">
                    No employees yet. Add the first one.
                  </p>
                </TableCell>
              </TableRow>
            ) : (
              employees.map((e) => {
                const homeBranch = Array.isArray(e.home_branch) ? e.home_branch[0] : e.home_branch;
                const commissionClass = Array.isArray(e.commission_class)
                  ? e.commission_class[0]
                  : e.commission_class;
                const position = Array.isArray(e.position) ? e.position[0] : e.position;
                const employeeItem: EmployeeItem = {
                  id: e.id,
                  employee_code: e.employee_code,
                  name: e.name,
                  phone: e.phone,
                  email: e.email,
                  gender: e.gender,
                  home_branch_id: e.home_branch_id,
                  commission_class_id: e.commission_class_id,
                  position_id: e.position_id,
                  status: e.status as EmployeeItem['status'],
                };
                return (
                  <TableRow key={e.id}>
                    <TableCell className="font-mono font-bold">{e.employee_code}</TableCell>
                    <TableCell className="font-semibold">{e.name}</TableCell>
                    <TableCell className="font-medium tabular text-muted-foreground">
                      {e.phone ?? '—'}
                    </TableCell>
                    <TableCell className="font-medium">
                      {homeBranch ? (
                        <span className="font-mono font-bold">{homeBranch.code}</span>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </TableCell>
                    <TableCell className="font-medium">
                      {commissionClass ? (
                        <span>
                          <span className="font-mono font-bold">{commissionClass.class_code}</span>
                          <span className="text-muted-foreground ml-1">
                            ({(commissionClass.commission_rate * 100).toFixed(0)}%)
                          </span>
                        </span>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </TableCell>
                    <TableCell className="font-medium">
                      {position ? (
                        <span className="font-semibold">{position.name}</span>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </TableCell>
                    <TableCell>{statusBadge(e.status as EmployeeItem['status'])}</TableCell>
                    <TableCell>
                      <EmployeeRowActions
                        employee={employeeItem}
                        branches={branches}
                        classes={classes}
                        positions={positions}
                      />
                    </TableCell>
                  </TableRow>
                );
              })
            )}
          </TableBody>
        </Table>
      </Card>
    </div>
  );
}
