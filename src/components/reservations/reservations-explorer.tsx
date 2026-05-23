'use client';

import { useMemo, useState } from 'react';
import { CalendarDays } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { ReservationRowActions } from '@/components/reservations/reservation-row-actions';
import type { ReservationItem } from '@/components/reservations/new-reservation-dialog';

export interface ReservationRow {
  id: string;
  reservation_no: string;
  branch_code: string;
  guest_name: string;
  guest_phone: string | null;
  service_names: string[];
  pinned_names: string[];
  source_code: string | null;
  pax: number;
  status: string;
  desired_service_start: string;
  desired_service_end: string;
  service_date: string; // PHT yyyy-mm-dd of the desired start, for date filtering
  edit: ReservationItem & { status: string };
}

interface SourceOpt { id: string; code: string; name: string; phone_required: boolean }
interface BranchOpt { id: string; code: string; name: string; businessUnitIds: string[] }
interface CategoryOpt { id: string; code: string; name: string; businessUnitIds: string[]; requiredResourceType: string | null }

const STATUS_VARIANT: Record<string, 'default' | 'secondary' | 'destructive'> = {
  reserved: 'secondary',
  confirmed: 'default',
  converted: 'default',
  cancelled: 'destructive',
  no_show: 'destructive',
};
const STATUS_OPTIONS = ['reserved', 'confirmed', 'converted', 'cancelled', 'no_show'];
const ALL = '__all__';
const ACTIVE = ['reserved', 'confirmed'];

function fmt(ts: string): string {
  return new Date(ts).toLocaleString('en-PH', {
    timeZone: 'Asia/Manila',
    month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
  });
}
function fmtTime(ts: string): string {
  return new Date(ts).toLocaleTimeString('en-PH', { timeZone: 'Asia/Manila', hour: '2-digit', minute: '2-digit' });
}

export function ReservationsExplorer({
  rows,
  branches,
  sources,
  serviceCategories,
}: {
  rows: ReservationRow[];
  branches: BranchOpt[];
  sources: SourceOpt[];
  serviceCategories: CategoryOpt[];
}) {
  const [q, setQ] = useState('');
  const [branch, setBranch] = useState(ALL);
  const [status, setStatus] = useState(ALL);
  const [source, setSource] = useState(ALL);
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');

  const filtered = useMemo(
    () =>
      rows.filter((r) => {
        if (branch !== ALL && r.branch_code !== branch) return false;
        if (status === ACTIVE.join(',')) { if (!ACTIVE.includes(r.status)) return false; }
        else if (status !== ALL && r.status !== status) return false;
        if (source !== ALL && r.source_code !== source) return false;
        if (from && r.service_date < from) return false;
        if (to && r.service_date > to) return false;
        if (q) {
          const hay = `${r.reservation_no} ${r.guest_name} ${r.guest_phone ?? ''}`.toLowerCase();
          if (!hay.includes(q.toLowerCase())) return false;
        }
        return true;
      }),
    [rows, q, branch, status, source, from, to],
  );
  const activeCount = filtered.filter((r) => ACTIVE.includes(r.status)).length;

  // Base UI's <SelectValue /> needs an items map to render labels in the
  // trigger (otherwise it prints the raw value, e.g. "__all__").
  const branchItems = [{ value: ALL, label: 'All' }, ...branches.map((b) => ({ value: b.code, label: b.code }))];
  const statusItems = [
    { value: ALL, label: 'All' },
    { value: ACTIVE.join(','), label: 'Active (reserved + confirmed)' },
    ...STATUS_OPTIONS.map((s) => ({ value: s, label: s.replace('_', ' ') })),
  ];
  const sourceItems = [{ value: ALL, label: 'All' }, ...sources.map((s) => ({ value: s.code, label: s.code }))];

  return (
    <div className="flex flex-col gap-4">
      <Card className="p-4">
        <div className="flex flex-wrap items-end gap-3">
          <div className="flex flex-col gap-1">
            <Label className="text-xs font-semibold">Date From</Label>
            <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="w-40" />
          </div>
          <div className="flex flex-col gap-1">
            <Label className="text-xs font-semibold">Date To</Label>
            <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="w-40" />
          </div>
          <div className="flex flex-col gap-1">
            <Label className="text-xs font-semibold">Branch</Label>
            <Select items={branchItems} value={branch} onValueChange={(v) => v && setBranch(v)}>
              <SelectTrigger className="w-32"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>All</SelectItem>
                {branches.map((b) => <SelectItem key={b.id} value={b.code}>{b.code}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="flex flex-col gap-1">
            <Label className="text-xs font-semibold">Status</Label>
            <Select items={statusItems} value={status} onValueChange={(v) => v && setStatus(v)}>
              <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>All</SelectItem>
                <SelectItem value={ACTIVE.join(',')}>Active (reserved + confirmed)</SelectItem>
                {STATUS_OPTIONS.map((s) => <SelectItem key={s} value={s} className="capitalize">{s.replace('_', ' ')}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="flex flex-col gap-1">
            <Label className="text-xs font-semibold">Source</Label>
            <Select items={sourceItems} value={source} onValueChange={(v) => v && setSource(v)}>
              <SelectTrigger className="w-36"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>All</SelectItem>
                {sources.map((s) => <SelectItem key={s.id} value={s.code}>{s.code}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="flex flex-col gap-1">
            <Label className="text-xs font-semibold">Search</Label>
            <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Guest, no, phone…" className="w-52" />
          </div>
          <p className="ml-auto text-sm font-semibold text-muted-foreground">
            {filtered.length} shown · {activeCount} active
          </p>
        </div>
      </Card>

      <Card className="p-0 overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-[190px] font-bold whitespace-nowrap">Reservation No</TableHead>
              <TableHead className="w-16 font-bold">Branch</TableHead>
              <TableHead className="w-44 font-bold">Guest</TableHead>
              <TableHead className="min-w-[260px] font-bold">Service</TableHead>
              <TableHead className="w-24 font-bold">Source</TableHead>
              <TableHead className="w-14 font-bold">PAX</TableHead>
              <TableHead className="w-[200px] font-bold whitespace-nowrap">Desired Time</TableHead>
              <TableHead className="w-28 font-bold">Status</TableHead>
              <TableHead className="w-12" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {filtered.length === 0 ? (
              <TableRow>
                <TableCell colSpan={9} className="text-center py-16">
                  <CalendarDays className="size-8 mx-auto text-muted-foreground/50" />
                  <p className="text-sm font-semibold text-muted-foreground mt-3">
                    {rows.length === 0 ? 'No reservations yet. Click “New Reservation” to book one.' : 'No reservations match these filters.'}
                  </p>
                </TableCell>
              </TableRow>
            ) : (
              filtered.map((r) => (
                <TableRow key={r.id}>
                  <TableCell className="font-mono font-bold whitespace-nowrap">{r.reservation_no}</TableCell>
                  <TableCell className="font-mono font-bold">{r.branch_code}</TableCell>
                  <TableCell className="font-semibold">
                    <div>{r.guest_name}</div>
                    {r.guest_phone && <div className="font-medium text-muted-foreground text-xs tabular">{r.guest_phone}</div>}
                  </TableCell>
                  <TableCell className="font-medium">
                    {r.service_names.length ? r.service_names.join(', ') : '—'}
                    {r.pinned_names.length > 0 && (
                      <span className="ml-2 inline-flex items-center rounded bg-violet-500/15 px-1.5 py-0.5 text-[11px] font-bold text-violet-700 dark:text-violet-300">
                        🛏 {r.pinned_names.join(', ')}
                      </span>
                    )}
                  </TableCell>
                  <TableCell className="font-mono font-semibold text-sm">{r.source_code ?? '—'}</TableCell>
                  <TableCell className="font-bold tabular">{r.pax}</TableCell>
                  <TableCell className="font-medium tabular text-sm whitespace-nowrap">
                    {fmt(r.desired_service_start)} – {fmtTime(r.desired_service_end)}
                  </TableCell>
                  <TableCell>
                    <Badge variant={STATUS_VARIANT[r.status] ?? 'secondary'} className="font-bold capitalize">
                      {r.status.replace('_', ' ')}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <ReservationRowActions
                      reservation={r.edit}
                      branches={branches}
                      sources={sources}
                      serviceCategories={serviceCategories}
                    />
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </Card>
    </div>
  );
}
