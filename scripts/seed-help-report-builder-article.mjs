#!/usr/bin/env node
// One-off: insert (or refresh) the "Report Builder" help article.
// Usage: node scripts/seed-help-report-builder-article.mjs

import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const envText = readFileSync(resolve(__dirname, '..', '.env.local'), 'utf8');
const env = Object.fromEntries(
  envText
    .split('\n')
    .filter((l) => l.trim() && !l.trim().startsWith('#'))
    .map((l) => {
      const i = l.indexOf('=');
      return [l.slice(0, i).trim(), l.slice(i + 1).trim()];
    }),
);

const supabase = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SECRET_KEY);

const SLUG = 'report-builder';
const content = readFileSync(resolve(__dirname, 'help-report-builder-article.md'), 'utf8');

const row = {
  slug: SLUG,
  title: 'Report Builder — build your own summary reports',
  category: 'daily_ops',
  content_markdown: content,
  is_published: true,
  order_index: 10,
};

async function main() {
  // Upsert by slug so re-running just refreshes the content.
  const { data: existing } = await supabase.from('help_articles').select('id').eq('slug', SLUG).maybeSingle();
  if (existing) {
    const { error } = await supabase.from('help_articles').update(row).eq('id', existing.id);
    if (error) throw error;
    console.log(`Updated help article (${existing.id}).`);
  } else {
    const { data, error } = await supabase.from('help_articles').insert(row).select('id').single();
    if (error) throw error;
    console.log(`Inserted help article (${data.id}).`);
  }
}

main().catch((e) => {
  console.error('Failed:', e.message ?? e);
  process.exit(1);
});