import Link from 'next/link';
import { redirect } from 'next/navigation';
import { ChevronLeft, Plus } from 'lucide-react';

import { currentSession, isAdmin } from '@/lib/auth';
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
import { SettingFormDialog, type SettingItem } from '@/components/settings/setting-form-dialog';
import { SettingRowActions } from '@/components/settings/setting-row-actions';

export const dynamic = 'force-dynamic';

async function fetchData() {
  const supabase = createServiceClient();
  const [s, b] = await Promise.all([
    supabase
      .from('settings')
      .select(`
        id, key, value, value_type, description, scope, branch_id,
        branch:branches ( code )
      `)
      .order('key'),
    supabase.from('branches').select('id, code, name').eq('active', true).order('code'),
  ]);
  if (s.error) throw new Error(s.error.message);
  if (b.error) throw new Error(b.error.message);
  return { settings: s.data ?? [], branches: b.data ?? [] };
}

export default async function SystemSettingsPage() {
  if (!isAdmin(await currentSession())) redirect('/dashboard');
  const { settings, branches } = await fetchData();
  const globalCount = settings.filter((s) => s.scope === 'global').length;

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
          <h2 className="text-3xl font-bold tracking-tight mt-1">System Settings</h2>
          <p className="text-sm font-semibold text-muted-foreground mt-1">
            {settings.length} total · {globalCount} global · Runtime-tunable parameters (no code change)
          </p>
        </div>
        <SettingFormDialog
          branches={branches}
          trigger={
            <Button>
              <Plus className="size-4" />
              Add Setting
            </Button>
          }
        />
      </div>

      <Card className="p-0 overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="font-bold">Key</TableHead>
              <TableHead className="font-bold">Value</TableHead>
              <TableHead className="w-24 font-bold">Type</TableHead>
              <TableHead className="font-bold">Description</TableHead>
              <TableHead className="w-24 font-bold">Scope</TableHead>
              <TableHead className="w-12" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {settings.length === 0 ? (
              <TableRow>
                <TableCell colSpan={6} className="text-center py-12">
                  <p className="text-sm font-semibold text-muted-foreground">
                    No system settings yet. Add the first magic number.
                  </p>
                </TableCell>
              </TableRow>
            ) : (
              settings.map((s) => {
                const branch = Array.isArray(s.branch) ? s.branch[0] : s.branch;
                const itemRecord: SettingItem = {
                  id: s.id,
                  key: s.key,
                  value: s.value,
                  value_type: s.value_type as SettingItem['value_type'],
                  description: s.description,
                  scope: s.scope as SettingItem['scope'],
                  branch_id: s.branch_id,
                };
                return (
                  <TableRow key={s.id}>
                    <TableCell className="font-mono font-bold text-xs">{s.key}</TableCell>
                    <TableCell className="font-bold tabular">{s.value}</TableCell>
                    <TableCell>
                      <Badge variant="secondary" className="font-bold font-mono text-xs">
                        {s.value_type}
                      </Badge>
                    </TableCell>
                    <TableCell className="font-medium text-muted-foreground text-sm">
                      {s.description ?? '—'}
                    </TableCell>
                    <TableCell>
                      {s.scope === 'global' ? (
                        <Badge className="font-bold">Global</Badge>
                      ) : (
                        <Badge variant="secondary" className="font-bold">
                          {branch ? branch.code : 'Branch'}
                        </Badge>
                      )}
                    </TableCell>
                    <TableCell>
                      <SettingRowActions setting={itemRecord} branches={branches} />
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
