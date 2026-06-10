'use client';

import { type MouseEvent, useState } from 'react';

import { cn } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';
import { Markdown } from '@/components/help/markdown';

export interface HelpArticle {
  id: string;
  slug: string;
  title: string;
  category: string;
  content_markdown: string;
}

const CATEGORY_LABEL: Record<string, string> = {
  getting_started: 'Getting started',
  daily_ops: 'Daily ops',
  reconciliation: 'Reconciliation',
  master_data: 'Master data',
  troubleshooting: 'Troubleshooting',
  api_integration: 'API / integration',
};
// Sidebar category order (matches the New Article picker); anything unknown
// falls to the end, then alphabetical.
const CATEGORY_ORDER = ['getting_started', 'daily_ops', 'reconciliation', 'master_data', 'troubleshooting', 'api_integration'];

// Two-pane help browser: a sticky topic list on the left (grouped by category),
// the selected article rendered on the right. Articles arrive pre-sorted by
// category + order_index, so each group keeps that order.
export function HelpBrowser({ articles }: { articles: HelpArticle[] }) {
  const [selectedId, setSelectedId] = useState(articles[0]?.id ?? '');
  const selected = articles.find((a) => a.id === selectedId) ?? articles[0] ?? null;

  // In-article links written as [text](#help/<slug>) jump to that article instead
  // of navigating the browser. Handled by event delegation on the article pane.
  const idBySlug = new Map(articles.map((a) => [a.slug, a.id]));
  function handleArticleClick(e: MouseEvent<HTMLDivElement>) {
    const anchor = (e.target as HTMLElement).closest('a');
    const href = anchor?.getAttribute('href') ?? '';
    const match = href.match(/^#help\/(.+)$/);
    if (!match) return;
    const targetId = idBySlug.get(decodeURIComponent(match[1]));
    if (!targetId) return;
    e.preventDefault();
    setSelectedId(targetId);
    if (typeof window !== 'undefined') window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  const byCategory = new Map<string, HelpArticle[]>();
  for (const a of articles) {
    const arr = byCategory.get(a.category) ?? [];
    arr.push(a);
    byCategory.set(a.category, arr);
  }
  const cats = [...byCategory.keys()].sort((a, b) => {
    const ia = CATEGORY_ORDER.indexOf(a); const ib = CATEGORY_ORDER.indexOf(b);
    return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib) || a.localeCompare(b);
  });

  return (
    <div className="grid items-start gap-6 md:grid-cols-[15rem_minmax(0,1fr)]">
      {/* Topic list — sticky on desktop so it stays put while the article scrolls. */}
      <nav className="flex flex-col gap-4 rounded-lg border border-border bg-card p-3 md:sticky md:top-4">
        {cats.map((cat) => (
          <div key={cat} className="flex flex-col gap-0.5">
            <div className="px-2 pb-0.5 text-[11px] font-bold uppercase tracking-[0.12em] text-muted-foreground">
              {CATEGORY_LABEL[cat] ?? cat}
            </div>
            {byCategory.get(cat)!.map((a) => (
              <button
                key={a.id}
                type="button"
                onClick={() => setSelectedId(a.id)}
                className={cn(
                  'rounded-md px-2 py-1.5 text-left text-sm font-semibold transition-colors',
                  a.id === selected?.id ? 'bg-primary/10 text-primary' : 'text-foreground/80 hover:bg-accent',
                )}
              >
                {a.title}
              </button>
            ))}
          </div>
        ))}
      </nav>

      {/* Selected article. */}
      <div className="min-w-0 rounded-lg border border-border bg-card p-5" onClick={handleArticleClick}>
        {selected ? (
          <>
            <div className="mb-4 flex flex-wrap items-center gap-2 border-b border-border pb-3">
              <h3 className="text-xl font-bold">{selected.title}</h3>
              <Badge variant="secondary" className="font-bold capitalize">{CATEGORY_LABEL[selected.category] ?? selected.category}</Badge>
            </div>
            <Markdown>{selected.content_markdown}</Markdown>
          </>
        ) : (
          <p className="text-sm font-medium text-muted-foreground">Select a topic from the list.</p>
        )}
      </div>
    </div>
  );
}
