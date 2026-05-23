'use client';

import { useState, useTransition } from 'react';
import Link from 'next/link';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { setBranchShareGroup } from '@/app/(dashboard)/settings/branches/actions';

export interface BranchGroupRow {
  id: string;
  code: string;
  name: string;
  group: string | null;
}

function GroupCell({ row }: { row: BranchGroupRow }) {
  const [value, setValue] = useState(row.group ?? '');
  const [pending, start] = useTransition();
  const dirty = (value.trim() || null) !== (row.group ?? null);

  function save() {
    start(async () => {
      const r = await setBranchShareGroup(row.id, value);
      if (r.ok) toast.success(value.trim() ? `${row.code} → ${value.trim()}` : `${row.code} sharing cleared`);
      else toast.error(r.error);
    });
  }

  return (
    <div className="flex items-center gap-2">
      <Input
        list="share-groups"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder="(none)"
        className="w-56"
        maxLength={60}
      />
      <Button type="button" size="sm" variant={dirty ? 'default' : 'ghost'} disabled={!dirty || pending} onClick={save}>
        {pending ? '…' : 'Save'}
      </Button>
    </div>
  );
}

export function TherapistGroupEditor({ branches }: { branches: BranchGroupRow[] }) {
  // Distinct existing group names → grouped summary + datalist suggestions.
  const groups = new Map<string, string[]>();
  for (const b of branches) {
    if (b.group) (groups.get(b.group) ?? groups.set(b.group, []).get(b.group)!).push(b.code);
  }
  const suggestions = [...groups.keys()].sort();

  return (
    <div className="flex flex-col gap-4">
      <datalist id="share-groups">
        {suggestions.map((g) => <option key={g} value={g} />)}
      </datalist>
      {groups.size > 0 && (
        <div className="flex flex-wrap gap-2">
          {[...groups.entries()].map(([g, codes]) => (
            <span key={g} className="inline-flex items-center gap-1.5 rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-1.5 text-sm font-bold text-amber-700 dark:text-amber-400">
              {g}
              <span className="font-mono font-semibold text-xs text-muted-foreground">{codes.sort().join(' · ')}</span>
            </span>
          ))}
        </div>
      )}

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="w-24 font-bold">Branch</TableHead>
            <TableHead className="font-bold">Name</TableHead>
            <TableHead className="font-bold">Sharing group</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {branches.map((b) => (
            <TableRow key={b.id}>
              <TableCell className="font-mono font-bold">
                <Link href="/settings/branches" className="hover:text-primary">{b.code}</Link>
              </TableCell>
              <TableCell className="font-semibold">{b.name}</TableCell>
              <TableCell><GroupCell row={b} /></TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
