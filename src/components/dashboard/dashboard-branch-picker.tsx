'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { ChevronDown, Check } from 'lucide-react';

import { cn } from '@/lib/utils';
import { TopBarPortal } from '@/components/layout/topbar-portal';

interface Props {
  branches: { id: string; code: string; name: string }[];
  selected: string[];
}

// Multi-select branch picker hoisted into the global top bar (top-right), mirror
// of the Calendar's picker. Ticking branches narrows every dashboard figure to
// the selection; at least one branch always stays on. Drives `/dashboard?branch`.
export function DashboardBranchPicker({ branches, selected }: Props) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const selSet = new Set(selected);
  const label = selected.length >= branches.length ? 'All branches'
    : selected.length === 1 ? (branches.find((b) => b.id === selected[0])?.code ?? '1 branch')
    : `${branches.find((b) => b.id === selected[0])?.code ?? ''} +${selected.length - 1}`;

  function toggle(id: string) {
    const next = new Set(selSet);
    if (next.has(id)) { if (next.size > 1) next.delete(id); } else next.add(id);
    const branch = branches.filter((b) => next.has(b.id)).map((b) => b.id).join(',');
    router.push(`/dashboard?branch=${branch}`);
  }

  return (
    <TopBarPortal>
      <div className="relative">
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          className="flex w-56 items-center justify-between gap-2 rounded-lg border border-input bg-transparent px-3 py-1.5 text-sm font-semibold"
        >
          <span className="truncate">{label}</span>
          <ChevronDown className="size-4 shrink-0 opacity-60" />
        </button>
        {open && (
          <>
            <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
            <div className="absolute right-0 z-50 mt-1 max-h-80 w-60 overflow-y-auto rounded-lg border border-border bg-popover p-1 shadow-lg">
              {branches.map((b) => {
                const on = selSet.has(b.id);
                return (
                  <button
                    key={b.id}
                    type="button"
                    onClick={() => toggle(b.id)}
                    className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm hover:bg-accent"
                  >
                    <span className={cn('flex size-4 shrink-0 items-center justify-center rounded border', on ? 'border-primary bg-primary text-primary-foreground' : 'border-input')}>
                      {on && <Check className="size-3" />}
                    </span>
                    <span className="font-semibold">{b.code}</span>
                    <span className="truncate text-muted-foreground">{b.name}</span>
                  </button>
                );
              })}
            </div>
          </>
        )}
      </div>
    </TopBarPortal>
  );
}
