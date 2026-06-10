'use client';

import { Bell, CalendarClock, PanelLeftOpen, Search } from 'lucide-react';
import Link from 'next/link';

import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { useSidebar } from '@/components/layout/sidebar-context';

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
  const { collapsed, toggle } = useSidebar();
  const initials = userName
    ?.split(' ')
    .map((s) => s[0])
    .slice(0, 2)
    .join('')
    .toUpperCase();

  return (
    <header className="flex h-16 items-center justify-between border-b border-border bg-background px-6 print:hidden">
      <div className="flex items-center gap-3">
        {/* Hamburger re-opens the sidebar when collapsed; the chevron inside
            the sidebar header collapses it. Two distinct controls keep both
            states' affordance obvious. */}
        {collapsed && (
          <button
            type="button"
            onClick={toggle}
            aria-label="Open sidebar"
            className="grid size-9 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            <PanelLeftOpen className="size-5" strokeWidth={1.75} />
          </button>
        )}
        <Link
          href="/calendar"
          aria-label="Calendar"
          className="grid size-9 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        >
          <CalendarClock className="size-5" strokeWidth={1.75} />
        </Link>
        {title && <h1 className="text-lg font-semibold tracking-tight">{title}</h1>}
      </div>

      <div className="flex items-center gap-3">
        {/* Page-specific header actions portal here (e.g. the Calendar
            branch switcher). Empty on pages that render nothing into it. */}
        <div id="topbar-slot" className="flex items-center gap-3 empty:hidden" />
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
