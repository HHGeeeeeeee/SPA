'use client';

import { useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { ChevronDown } from 'lucide-react';

import { cn } from '@/lib/utils';
import { SpaLeaf } from '@/components/icons/spa-leaf';
import { mainNavItems, bottomNavItems, type NavItem } from './sidebar-nav-items';

function isActive(pathname: string, href?: string, children?: { href: string }[]): boolean {
  if (href && (pathname === href || pathname.startsWith(href + '/'))) return true;
  if (children) {
    return children.some((c) => pathname === c.href || pathname.startsWith(c.href + '/'));
  }
  return false;
}

function NavLink({
  item,
  pathname,
}: {
  item: NavItem;
  pathname: string;
}) {
  const flatChildren = item.children ?? item.childGroups?.flatMap((g) => g.items);
  const hasChildren = !!flatChildren?.length;
  const active = isActive(pathname, item.href, flatChildren);
  const [open, setOpen] = useState(active);
  const Icon = item.icon;

  if (!hasChildren && item.href) {
    return (
      <Link
        href={item.href}
        className={cn(
          'flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors',
          'hover:bg-sidebar-accent hover:text-sidebar-accent-foreground',
          active
            ? 'bg-sidebar-primary/15 text-sidebar-primary font-bold'
            : 'text-sidebar-foreground/85 font-semibold',
        )}
      >
        <Icon className="size-[18px] shrink-0" strokeWidth={1.75} />
        <span className="truncate">{item.label}</span>
      </Link>
    );
  }

  return (
    <div>
      <div
        className={cn(
          'flex items-center rounded-lg text-sm transition-colors',
          'hover:bg-sidebar-accent hover:text-sidebar-accent-foreground',
          active
            ? 'bg-sidebar-primary/15 text-sidebar-primary font-bold'
            : 'text-sidebar-foreground/85 font-semibold',
        )}
      >
        {item.href ? (
          // Parent with its own page (e.g. a hub): the label navigates, the
          // chevron toggles the children.
          <Link href={item.href} className="flex min-w-0 flex-1 items-center gap-3 px-3 py-2">
            <Icon className="size-[18px] shrink-0" strokeWidth={1.75} />
            <span className="truncate">{item.label}</span>
          </Link>
        ) : (
          <button type="button" onClick={() => setOpen((v) => !v)} className="flex min-w-0 flex-1 items-center gap-3 px-3 py-2 text-left">
            <Icon className="size-[18px] shrink-0" strokeWidth={1.75} />
            <span className="truncate">{item.label}</span>
          </button>
        )}
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-label={open ? 'Collapse' : 'Expand'}
          className="shrink-0 px-2.5 py-2"
        >
          <ChevronDown className={cn('size-4 transition-transform', open && 'rotate-180')} strokeWidth={2} />
        </button>
      </div>
      {open && (item.children || item.childGroups) && (
        <div className="mt-1 ml-3 flex flex-col gap-px border-l border-sidebar-border pl-3">
          {item.children?.map((c) => (
            <ChildLink key={c.href} item={c} pathname={pathname} />
          ))}
          {item.childGroups?.map((group, idx) => (
            <div key={group.label} className={cn('flex flex-col gap-px', idx > 0 && 'mt-2')}>
              <p className="mx-3 pt-1 pb-1 mb-1 border-b border-sidebar-border text-[10px] font-bold uppercase tracking-[0.12em] text-muted-foreground">
                {group.label}
              </p>
              {group.items.map((c) => (
                <ChildLink key={c.href} item={c} pathname={pathname} />
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function ChildLink({
  item,
  pathname,
}: {
  item: { label: string; href: string };
  pathname: string;
}) {
  const active = pathname === item.href || pathname.startsWith(item.href + '/');
  return (
    <Link
      href={item.href}
      className={cn(
        'rounded-md px-3 py-1.5 text-sm transition-colors',
        'hover:bg-sidebar-accent hover:text-sidebar-accent-foreground',
        active
          ? 'text-sidebar-primary font-bold'
          : 'text-sidebar-foreground/75 font-semibold',
      )}
    >
      {item.label}
    </Link>
  );
}

export function Sidebar() {
  const pathname = usePathname();

  return (
    <aside className="flex h-screen w-64 shrink-0 flex-col border-r border-sidebar-border bg-sidebar">
      {/* Logo */}
      <div className="flex h-16 items-center gap-2 border-b border-sidebar-border px-5">
        <div className="grid size-10 place-items-center rounded-xl bg-primary/10 text-primary">
          <SpaLeaf className="size-7" />
        </div>
        <div className="flex flex-col leading-tight">
          <span className="text-base font-bold tracking-tight">HHG-SPA</span>
          <span className="text-[10px] font-semibold text-muted-foreground tracking-[0.15em] uppercase">
            POS System
          </span>
        </div>
      </div>

      {/* Main nav */}
      <nav className="flex-1 overflow-y-auto px-3 py-4">
        <div className="flex flex-col gap-1">
          {mainNavItems.map((item) => (
            <NavLink key={item.label} item={item} pathname={pathname} />
          ))}
        </div>
      </nav>

      {/* Bottom nav */}
      <div className="border-t border-sidebar-border px-3 py-3">
        <div className="flex flex-col gap-1">
          {bottomNavItems.map((item) => {
            const Icon = item.icon;
            return (
              <Link
                key={item.label}
                href={item.href}
                className={cn(
                  'flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-semibold transition-colors',
                  item.destructive
                    ? 'text-destructive hover:bg-destructive/10'
                    : 'text-sidebar-foreground/85 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground',
                )}
              >
                <Icon className="size-[18px] shrink-0" strokeWidth={1.75} />
                <span className="truncate">{item.label}</span>
              </Link>
            );
          })}
        </div>
      </div>
    </aside>
  );
}
