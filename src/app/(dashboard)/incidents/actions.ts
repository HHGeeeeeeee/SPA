'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';

import { createServiceClient } from '@/lib/supabase/server';
import { currentSession, isManager } from '@/lib/auth';

export type ActionResult = { ok: true } | { ok: false; error: string };

const reportSchema = z.object({
  related_order_id: z.string().uuid().optional().nullable(),
  customer_name: z.string().min(1).max(120),
  customer_phone: z.string().max(40).optional().nullable(),
  incident_type: z.enum(['complaint', 'accident', 'equipment_failure', 'staff_issue', 'service_quality', 'other']),
  severity: z.enum(['low', 'medium', 'high']),
  description: z.string().min(3).max(2000),
  follow_up_required: z.boolean().optional(),
});

export async function reportIncident(input: unknown): Promise<ActionResult> {
  const parsed = reportSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? 'Invalid input' };
  const d = parsed.data;
  const session = await currentSession();
  const supabase = createServiceClient();
  const { error } = await supabase.from('incident_log').insert({
    related_order_id: d.related_order_id || null,
    customer_name: d.customer_name,
    customer_phone: d.customer_phone || null,
    incident_type: d.incident_type,
    severity: d.severity,
    description: d.description,
    follow_up_required: d.follow_up_required ?? false,
    reported_by_staff_id: session?.staffUserId ?? null,
    reported_at: new Date().toISOString(),
  });
  if (error) return { ok: false, error: error.message };
  revalidatePath('/incidents');
  if (d.related_order_id) revalidatePath(`/sales-orders/${d.related_order_id}`);
  return { ok: true };
}

export async function resolveIncident(id: string, action: string): Promise<ActionResult> {
  const session = await currentSession();
  if (!isManager(session)) return { ok: false, error: 'Manager permission required' };
  const supabase = createServiceClient();
  const { error } = await supabase
    .from('incident_log')
    .update({ resolved: true, resolved_at: new Date().toISOString(), resolved_by_staff_id: session!.staffUserId, resolution_action: action || null })
    .eq('id', id);
  if (error) return { ok: false, error: error.message };
  revalidatePath('/incidents');
  return { ok: true };
}
