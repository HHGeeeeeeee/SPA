import Link from 'next/link';
import { ChevronLeft, KeyRound, Plus } from 'lucide-react';

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
import { UserFormDialog, type StaffUserItem, type UserRole } from '@/components/settings/user-form-dialog';
import { UserRowActions } from '@/components/settings/user-row-actions';

export const dynamic = 'force-dynamic';

async function fetchData() {
  const supabase = createServiceClient();
  const [u, b] = await Promise.all([
    supabase
      .from('staff_users')
      .select(`
        id, email, acumatica_user_id, display_name, role, home_branch_id,
        active, last_login_at, manager_pin_hash,
        home_branch:branches!staff_users_home_branch_id_fkey ( code, name ),
        staff_user_branches ( branch_id, branches ( id, code, name ) )
      `)
      .order('acumatica_user_id'),
    supabase.from('branches').select('id, code, name').eq('active', true).order('code'),
  ]);
  if (u.error) throw new Error(u.error.message);
  if (b.error) throw new Error(b.error.message);
  return { users: u.data ?? [], branches: b.data ?? [] };
}

const ROLE_LABEL: Record<UserRole, string> = {
  admin: 'Admin',
  manager: 'Manager',
  accountant: 'Accountant',
  staff: 'Staff',
  external_booker: 'External Booker',
};

function roleBadge(role: UserRole) {
  const map: Record<UserRole, 'default' | 'secondary' | 'destructive'> = {
    admin: 'destructive',
    manager: 'default',
    accountant: 'default',
    staff: 'secondary',
    external_booker: 'secondary',
  };
  return (
    <Badge variant={map[role]} className="font-bold">
      {ROLE_LABEL[role]}
    </Badge>
  );
}

export default async function UsersPage() {
  // Manager+ may view + manage users (2026-05-31 matrix change — was admin
  // only). The /settings layout already enforces isManager; this page no
  // longer adds an isAdmin redirect on top. requireManager on the actions
  // is the matching write-side guard.
  const { users, branches } = await fetchData();
  const activeCount = users.filter((u) => u.active).length;

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
          <h2 className="text-3xl font-bold tracking-tight mt-1">Users</h2>
          <p className="text-sm font-semibold text-muted-foreground mt-1">
            {users.length} total · {activeCount} active · Bridged to Acumatica login
          </p>
        </div>
        <UserFormDialog
          branches={branches}
          trigger={
            <Button>
              <Plus className="size-4" />
              Invite User
            </Button>
          }
        />
      </div>

      <Card className="p-0 overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="font-bold">Acumatica ID</TableHead>
              <TableHead className="font-bold">Display Name</TableHead>
              <TableHead className="font-bold">Role</TableHead>
              <TableHead className="font-bold">Branches</TableHead>
              <TableHead className="font-bold">PIN</TableHead>
              <TableHead className="font-bold">Last Login</TableHead>
              <TableHead className="w-24 font-bold">Status</TableHead>
              <TableHead className="w-12" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {users.length === 0 ? (
              <TableRow>
                <TableCell colSpan={8} className="text-center py-12">
                  <p className="text-sm font-semibold text-muted-foreground">
                    No users yet. Invite the first one — they get activated on first login.
                  </p>
                </TableCell>
              </TableRow>
            ) : (
              users.map((u) => {
                const accessible = (u.staff_user_branches ?? [])
                  .map((row) => (Array.isArray(row.branches) ? row.branches[0] : row.branches))
                  .filter(Boolean) as { id: string; code: string; name: string }[];
                const userRecord: StaffUserItem = {
                  id: u.id,
                  email: u.email,
                  acumatica_user_id: u.acumatica_user_id,
                  display_name: u.display_name,
                  role: u.role as UserRole,
                  home_branch_id: u.home_branch_id,
                  branch_ids: accessible.map((b) => b.id),
                  active: u.active,
                };
                return (
                  <TableRow key={u.id}>
                    <TableCell className="font-mono font-bold">{u.acumatica_user_id}</TableCell>
                    <TableCell className="font-semibold">
                      {u.display_name ?? <span className="text-muted-foreground">—</span>}
                    </TableCell>
                    <TableCell>{roleBadge(u.role as UserRole)}</TableCell>
                    <TableCell>
                      <div className="flex flex-wrap gap-1">
                        {accessible.length === 0 ? (
                          <span className="text-muted-foreground">—</span>
                        ) : (
                          accessible.map((b) => (
                            <Badge
                              key={b.id}
                              variant={b.id === u.home_branch_id ? 'default' : 'secondary'}
                              className="font-bold font-mono text-xs uppercase"
                            >
                              {b.code}
                            </Badge>
                          ))
                        )}
                      </div>
                    </TableCell>
                    <TableCell>
                      {u.manager_pin_hash ? (
                        <Badge variant="secondary" className="font-bold gap-1">
                          <KeyRound className="size-3" />
                          Set
                        </Badge>
                      ) : (
                        <span className="text-xs font-semibold text-muted-foreground">—</span>
                      )}
                    </TableCell>
                    <TableCell className="font-medium text-muted-foreground text-sm">
                      {u.last_login_at
                        ? new Date(u.last_login_at).toLocaleString('en-PH', {
                            dateStyle: 'medium',
                            timeStyle: 'short',
                          })
                        : 'Never'}
                    </TableCell>
                    <TableCell>
                      {u.active ? (
                        <Badge className="font-bold">Active</Badge>
                      ) : (
                        <Badge variant="secondary" className="font-bold">Pending</Badge>
                      )}
                    </TableCell>
                    <TableCell>
                      <UserRowActions
                        user={{ ...userRecord, has_pin: !!u.manager_pin_hash }}
                        branches={branches}
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
