import { BookOpen } from 'lucide-react';

import { createServiceClient } from '@/lib/supabase/server';
import { currentSession, isAdmin } from '@/lib/auth';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { NewArticleDialog } from '@/components/help/new-article-dialog';
import { Markdown } from '@/components/help/markdown';

export const dynamic = 'force-dynamic';

const CATEGORY_LABEL: Record<string, string> = {
  getting_started: 'Getting started',
  daily_ops: 'Daily ops',
  reconciliation: 'Reconciliation',
  master_data: 'Master data',
  troubleshooting: 'Troubleshooting',
  api_integration: 'API / integration',
};

export default async function HelpPage() {
  const supabase = createServiceClient();
  const admin = isAdmin(await currentSession());
  const { data } = await supabase
    .from('help_articles')
    .select('id, title, category, content_markdown')
    .eq('is_published', true)
    .order('category')
    .order('order_index');
  const articles = data ?? [];

  const byCategory = new Map<string, typeof articles>();
  for (const a of articles) {
    const arr = byCategory.get(a.category) ?? [];
    arr.push(a);
    byCategory.set(a.category, arr);
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-3xl font-bold tracking-tight">Help</h2>
          <p className="text-sm font-semibold text-muted-foreground mt-1">In-app documentation · {articles.length} article(s)</p>
        </div>
        {admin && <NewArticleDialog />}
      </div>

      {articles.length === 0 ? (
        <Card className="border-dashed bg-muted/30">
          <CardContent className="py-10 text-center">
            <BookOpen className="size-8 mx-auto text-muted-foreground/50" />
            <p className="text-sm font-semibold text-muted-foreground mt-3">
              No help articles yet.{admin ? ' Click “New Article” to write the first.' : ''}
            </p>
          </CardContent>
        </Card>
      ) : (
        [...byCategory.entries()].map(([cat, arts]) => (
          <div key={cat} className="flex flex-col gap-3">
            <h3 className="text-sm font-bold text-muted-foreground uppercase tracking-[0.12em]">{CATEGORY_LABEL[cat] ?? cat}</h3>
            {arts.map((a) => (
              <Card key={a.id}>
                <CardHeader className="pb-2 flex-row items-center gap-2">
                  <CardTitle className="text-base font-bold">{a.title}</CardTitle>
                  <Badge variant="secondary" className="font-bold capitalize">{CATEGORY_LABEL[a.category] ?? a.category}</Badge>
                </CardHeader>
                <CardContent>
                  <Markdown>{a.content_markdown}</Markdown>
                </CardContent>
              </Card>
            ))}
          </div>
        ))
      )}
    </div>
  );
}
