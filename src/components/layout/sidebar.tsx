'use client';

import { useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { ChevronDown, PanelLeftClose } from 'lucide-react';

import { cn } from '@/lib/utils';
import { SpaLeaf } from '@/components/icons/spa-leaf';
import { mainNavItems, bottomNavItems, type NavItem, type NavSubItem } from './sidebar-nav-items';
import { useSidebar } from './sidebar-context';

// Walk children once and emit segments of consecutive items that share a
// `section` marker. Items without a section get their own ungrouped segment
// so the renderer can style sectioned vs un-sectioned segments differently.
function groupChildrenBySection(children: NavSubItem[]): { section?: string; items: NavSubItem[] }[] {
  const segments: { section?: string; items: NavSubItem[] }[] = [];
  for (const c of children) {
    const last = segments[segments.length - 1];
    if (last && last.section === c.section) {
      last.items.push(c);
    } else {
      segments.push({ section: c.section, items: [c] });
    }
  }
  return segments;
}

// Per-section visual tone. All sections currently use the same neutral
// styling (gray border + muted label) — the section header text itself
// carries the meaning. SECTION_STYLES is kept as the override hook for
// future clusters that genuinely warrant emphasis.
const SECTION_STYLES: Record<string, { border: string; label: string }> = {};
const NEUTRAL_SECTION_STYLE = {
  border: 'border-l border-sidebar-border',
  label: 'text-muted-foreground/80',
};

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
  isAdmin,
  isManager,
}: {
  item: NavItem;
  pathname: string;
  isAdmin: boolean;
  isManager: boolean;
}) {
  // Strip admin-only / manager-only sub-items + sub-groups up front so the
  // chevron / active detection both see the post-filter view (a sub-group
  // that ends up empty after filtering disappears entirely rather than
  // rendering as a blank header).
  const allowed = (c: { adminOnly?: boolean; managerOnly?: boolean }) =>
    (!c.adminOnly || isAdmin) && (!c.managerOnly || isManager);
  const filteredChildren = item.children?.filter(allowed);
  const filteredChildGroups = item.childGroups
    ?.map((g) => ({ ...g, items: g.items.filter(allowed) }))
    .filter((g) => g.items.length > 0);
  const flatChildren = filteredChildren ?? filteredChildGroups?.flatMap((g) => g.items);
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
      {open && (filteredChildren || filteredChildGroups) && (
        <div className="mt-1 ml-3 flex flex-col gap-1">
          {/* Children rendered as section-aware segments: consecutive items
              with the same `section` share one wrapper. Sectioned segments
              get a primary-coloured left bar + small uppercase header so the
              grouping reads visually (e.g. Daily Close inside Reconciliation).
              Un-sectioned items fall back to the muted border-l, matching the
              previous single-bar look. */}
          {filteredChildren &&
            groupChildrenBySection(filteredChildren).map((seg, si) => {
              const style = seg.section
                ? SECTION_STYLES[seg.section] ?? NEUTRAL_SECTION_STYLE
                : NEUTRAL_SECTION_STYLE;
              return (
                <div
                  key={si}
                  className={cn('flex flex-col gap-px pl-3', style.border)}
                >
                  {seg.section && (
                    <p className={cn('text-[10px] font-bold uppercase tracking-[0.12em] mb-1 px-1', style.label)}>
                      {seg.section}
                    </p>
                  )}
                  {seg.items.map((c) => (
                    <ChildLink key={c.href} item={c} pathname={pathname} />
                  ))}
                </div>
              );
            })}
          {filteredChildGroups && (
            <div className="border-l border-sidebar-border pl-3 flex flex-col gap-px">
              {filteredChildGroups.map((group, idx) => (
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

export function Sidebar({
  isAdmin = false,
  isManager = false,
}: {
  isAdmin?: boolean;
  /** manager-or-above (admin always counts as manager). Drives the
   *  managerOnly nav-item filter — Settings, mainly. */
  isManager?: boolean;
}) {
  const pathname = usePathname();
  const { collapsed, toggle } = useSidebar();
  // Hide nav items flagged adminOnly / managerOnly when the viewer doesn't
  // match. Mirrors the server-side gates on those routes — keeps the menu
  // honest (no link the viewer can't actually open).
  const visibleNav = mainNavItems.filter(
    (item) => (!item.adminOnly || isAdmin) && (!item.managerOnly || isManager),
  );

  return (
    // Collapsed = full hide (width 0, border off) — matches the ENGO Back Office
    // pattern: sidebar disappears entirely, TopBar's hamburger restores it.
    // overflow-hidden clips the inner content so partial labels don't peek out
    // during the transition.
    <aside
      className={cn(
        'flex h-screen shrink-0 flex-col bg-sidebar transition-[width] duration-200 overflow-hidden',
        collapsed ? 'w-0 border-r-0' : 'w-64 border-r border-sidebar-border',
      )}
      aria-hidden={collapsed}
    >
      {/* Logo + collapse button */}
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
        <button
          type="button"
          onClick={toggle}
          aria-label="Collapse sidebar"
          tabIndex={collapsed ? -1 : 0}
          className="ml-auto grid size-7 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
        >
          <PanelLeftClose className="size-4" strokeWidth={2} />
        </button>
      </div>

      {/* Main nav */}
      <nav className="flex-1 overflow-y-auto px-3 py-4">
        <div className="flex flex-col gap-1">
          {visibleNav.map((item) => (
            <NavLink
              key={item.label}
              item={item}
              pathname={pathname}
              isAdmin={isAdmin}
              isManager={isManager}
            />
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
