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
  const hasChildren = !!item.children?.length;
  const active = isActive(pathname, item.href, item.children);
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
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={cn(
          'flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors',
          'hover:bg-sidebar-accent hover:text-sidebar-accent-foreground',
          active
            ? 'bg-sidebar-primary/15 text-sidebar-primary font-bold'
            : 'text-sidebar-foreground/85 font-semibold',
        )}
      >
        <Icon className="size-[18px] shrink-0" strokeWidth={1.75} />
        <span className="flex-1 truncate text-left">{item.label}</span>
        <ChevronDown
          className={cn('size-4 transition-transform', open && 'rotate-180')}
          strokeWidth={2}
        />
      </button>
      {open && item.children && (
        <div className="mt-1 ml-3 flex flex-col gap-px border-l border-sidebar-border pl-3">
          {item.children.map((c) => {
            const childActive = pathname === c.href || pathname.startsWith(c.href + '/');
            return (
              <Link
                key={c.href}
                href={c.href}
                className={cn(
                  'rounded-md px-3 py-1.5 text-sm transition-colors',
                  'hover:bg-sidebar-accent hover:text-sidebar-accent-foreground',
                  childActive
                    ? 'text-sidebar-primary font-bold'
                    : 'text-sidebar-foreground/75 font-semibold',
                )}
              >
                {c.label}
              </Link>
            );
          })}
        </div>
      )}
    </div>
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
