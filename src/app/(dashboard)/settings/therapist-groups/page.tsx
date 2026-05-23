import Link from 'next/link';

import { createServiceClient } from '@/lib/supabase/server';
import { Card } from '@/components/ui/card';
import { TherapistGroupEditor, type BranchGroupRow } from '@/components/settings/therapist-group-editor';

export const dynamic = 'force-dynamic';

export default async function TherapistGroupsPage() {
  const supabase = createServiceClient();
  const { data } = await supabase
    .from('branches')
    .select('id, code, name, therapist_share_group')
    .eq('active', true)
    .order('code');
  const branches: BranchGroupRow[] = (data ?? []).map((b) => ({
    id: b.id, code: b.code, name: b.name, group: b.therapist_share_group,
  }));

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h2 className="text-3xl font-bold tracking-tight">Therapist Sharing</h2>
        <p className="text-sm font-semibold text-muted-foreground mt-1">
          Branches with the same group name pool their therapists — they appear in each other&apos;s Shift Schedule and can be borrowed on orders.{' '}
          <Link href="/settings/branches" className="underline">Manage branches →</Link>
        </p>
      </div>

      {branches.length === 0 ? (
        <Card className="border-dashed bg-muted/30 p-8 text-center text-sm font-semibold text-muted-foreground">
          No active branches. Create one in Settings → Branches first.
        </Card>
      ) : (
        <Card className="p-4">
          <TherapistGroupEditor branches={branches} />
        </Card>
      )}
    </div>
  );
}
