import { BookOpen } from 'lucide-react';

import { createServiceClient } from '@/lib/supabase/server';
import { currentSession, isAdmin } from '@/lib/auth';
import { Card, CardContent } from '@/components/ui/card';
import { NewArticleDialog } from '@/components/help/new-article-dialog';
import { HelpBrowser } from '@/components/help/help-browser';

export const dynamic = 'force-dynamic';

export default async function HelpPage() {
  const supabase = createServiceClient();
  const admin = isAdmin(await currentSession());
  const { data } = await supabase
    .from('help_articles')
    .select('id, slug, title, category, content_markdown')
    .eq('is_published', true)
    .order('category')
    .order('order_index');
  const articles = data ?? [];

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
        <HelpBrowser articles={articles} />
      )}
    </div>
  );
}
