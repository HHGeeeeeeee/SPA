'use client';

import { Bell, Search } from 'lucide-react';

import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { CurrencyBadge } from '@/components/ui/currency-badge';

export interface TopBarProps {
  /**
   * Page title with optional breadcrumb prefix (e.g. "Reconciliation › Revenue SOA").
   */
  title?: string;
  /**
   * User display name. (Will be wired to session later.)
   */
  userName?: string;
}

export function TopBar({ title, userName }: TopBarProps) {
  const initials = userName
    ?.split(' ')
    .map((s) => s[0])
    .slice(0, 2)
    .join('')
    .toUpperCase();

  return (
    <header className="flex h-16 items-center justify-between border-b border-border bg-background px-6">
      <div className="flex flex-col">
        {title && <h1 className="text-lg font-semibold tracking-tight">{title}</h1>}
      </div>

      <div className="flex items-center gap-3">
        {/* Single-source currency indicator. Every amount on the POS is in this
            unit; no per-amount ₱ / PHP symbols are shown downstream. */}
        <CurrencyBadge />
        <button
          type="button"
          className="grid size-8 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          aria-label="Search"
        >
          <Search className="size-[18px]" strokeWidth={1.75} />
        </button>
        <button
          type="button"
          className="grid size-8 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          aria-label="Notifications"
        >
          <Bell className="size-[18px]" strokeWidth={1.75} />
        </button>
        <div className="ml-1 flex items-center gap-2">
          <Avatar className="size-8">
            <AvatarFallback className="bg-primary/10 text-primary text-xs font-medium">
              {initials ?? '?'}
            </AvatarFallback>
          </Avatar>
          {userName && (
            <span className="text-sm font-medium hidden sm:inline">{userName}</span>
          )}
        </div>
      </div>
    </header>
  );
}
