'use client';

import { Fragment, useState } from 'react';
import { Tag } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { ServiceItemRowActions } from '@/components/settings/service-item-row-actions';
import { BatchPriceDialog, type BatchTarget } from '@/components/settings/batch-price-dialog';
import type { ServiceItemRecord } from '@/components/settings/service-item-form-dialog';

export interface ServiceRowVM {
  id: string;
  code: string;
  name: string;
  duration_minutes: number;
  priceCents: number | null;
  validFrom: string | null;
  validTo: string | null;
  future: { price_cents: number; effective_from: string } | null;
  requiredResourceType: string | null;
  active: boolean;
  itemRecord: ServiceItemRecord;
}
export interface ServiceGroupVM {
  key: string;
  name: string;
  categoryCode: string;
  rows: ServiceRowVM[];
}

interface Opt { id: string; code: string; name: string }

export function ServiceItemsTable({
  groups,
  categories,
  businessUnits,
  groupNames,
}: {
  groups: ServiceGroupVM[];
  categories: Opt[];
  businessUnits: Opt[];
  groupNames: string[];
}) {
  const allRows = groups.flatMap((g) => g.rows);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [batchOpen, setBatchOpen] = useState(false);

  const allSelected = allRows.length > 0 && selected.size === allRows.length;
  function toggle(id: string) {
    setSelected((prev) => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });
  }
  function toggleAll() {
    setSelected(allSelected ? new Set() : new Set(allRows.map((r) => r.id)));
  }

  const targets: BatchTarget[] = allRows
    .filter((r) => selected.has(r.id))
    .map((r) => ({ id: r.id, label: `${r.code} — ${r.name}`, currentCents: r.priceCents }));

  return (
    <div className="flex flex-col gap-3">
      {selected.size > 0 && (
        <div className="sticky top-2 z-20 flex items-center justify-between gap-4 rounded-xl border border-border bg-card px-4 py-2.5 shadow-sm">
          <span className="text-sm font-bold">{selected.size} selected</span>
          <div className="flex items-center gap-2">
            <Button size="sm" variant="ghost" onClick={() => setSelected(new Set())}>Clear</Button>
            <Button size="sm" onClick={() => setBatchOpen(true)}>
              <Tag className="size-4" />
              Batch update prices ({selected.size})
            </Button>
          </div>
        </div>
      )}

      <Card className="p-0 overflow-hidden">
        {/* Fixed layout with explicit widths so no single column hogs the slack
            (Service Group used to absorb it all, leaving a big gap before Code). */}
        <Table className="table-fixed">
          <TableHeader>
            <TableRow>
              <TableHead className="w-12">
                <input type="checkbox" className="size-4 cursor-pointer accent-primary" checked={allSelected} onChange={toggleAll} aria-label="Select all" />
              </TableHead>
              {/* Every column has an explicit width; the content columns (Service
                  Group / Validity / Station) are wider so they absorb the slack on
                  wide screens instead of one column leaving a big gap. */}
              <TableHead className="w-64 font-bold">Service Group</TableHead>
              <TableHead className="w-28 font-bold">Code</TableHead>
              <TableHead className="w-24 font-bold">Duration</TableHead>
              <TableHead className="w-28 font-bold text-right">Price</TableHead>
              <TableHead className="w-64 font-bold">Validity</TableHead>
              <TableHead className="w-52 font-bold">Station</TableHead>
              <TableHead className="w-32 font-bold">Status</TableHead>
              <TableHead className="w-16" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {allRows.length === 0 ? (
              <TableRow>
                <TableCell colSpan={9} className="text-center py-12">
                  <p className="text-sm font-semibold text-muted-foreground">No service items yet.</p>
                </TableCell>
              </TableRow>
            ) : (
              groups.map((grp) => (
                <Fragment key={grp.key}>
                  {grp.rows.map((r, idx) => (
                    <TableRow key={r.id} className={idx === grp.rows.length - 1 ? 'border-b-2 border-border' : ''}>
                      <TableCell>
                        <input type="checkbox" className="size-4 cursor-pointer accent-primary" checked={selected.has(r.id)} onChange={() => toggle(r.id)} aria-label={`Select ${r.code}`} />
                      </TableCell>
                      {idx === 0 && (
                        <TableCell rowSpan={grp.rows.length} className="align-top border-r border-border">
                          <span className="font-extrabold block">{grp.name}</span>
                          <span className="font-mono font-bold text-xs text-muted-foreground uppercase">{grp.categoryCode}</span>
                        </TableCell>
                      )}
                      <TableCell className="font-mono font-bold">{r.code}</TableCell>
                      <TableCell className="font-bold tabular">{r.duration_minutes} min</TableCell>
                      <TableCell className="font-bold tabular text-right">
                        {r.priceCents != null ? `${(r.priceCents / 100).toLocaleString('en-PH')}` : <span className="text-muted-foreground">—</span>}
                      </TableCell>
                      <TableCell className="font-medium tabular text-sm text-muted-foreground">
                        {r.validFrom ? (
                          <>
                            {r.validFrom} <span className="text-muted-foreground/50">to</span> {r.validTo === '2999-12-31' ? 'open' : r.validTo}
                          </>
                        ) : '—'}
                        {r.future && (
                          <div className="text-[11px] font-semibold text-amber-600 dark:text-amber-400 mt-0.5">
                            → {(r.future.price_cents / 100).toLocaleString('en-PH')} from {r.future.effective_from}
                          </div>
                        )}
                      </TableCell>
                      <TableCell className="font-mono font-medium text-muted-foreground">
                        {r.requiredResourceType ?? '—'}
                      </TableCell>
                      <TableCell>
                        {r.active ? (
                          <Badge className="font-bold">Active</Badge>
                        ) : (
                          <Badge variant="secondary" className="font-bold">Inactive</Badge>
                        )}
                      </TableCell>
                      <TableCell>
                        <ServiceItemRowActions item={{ ...r.itemRecord, active: r.active }} categories={categories} businessUnits={businessUnits} groups={groupNames} />
                      </TableCell>
                    </TableRow>
                  ))}
                </Fragment>
              ))
            )}
          </TableBody>
        </Table>
      </Card>

      <BatchPriceDialog targets={targets} open={batchOpen} onOpenChange={setBatchOpen} onApplied={() => setSelected(new Set())} />
    </div>
  );
}
