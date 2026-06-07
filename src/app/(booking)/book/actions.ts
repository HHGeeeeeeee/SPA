'use server';

import { revalidatePath } from 'next/cache';

import { createServiceClient, createAuditedClient } from '@/lib/supabase/server';
import { currentSession, isExternalBooker } from '@/lib/auth';
import { getAllowedBranchIds, canAccessBranch } from '@/lib/branch-access';

const one = <T,>(v: T | T[] | null): T | null => (Array.isArray(v) ? (v[0] ?? null) : v);

export interface MyBookingRow {
  id: string;
  order_no: string;
  status: string;
  service_date: string;
  branch_code: string;
  source_name: string | null;
  guest_name: string | null;
  pax: number;
  services: string[];
  cancellable: boolean;
}

// Bookings THIS booker created — non-financial (no totals / payment). Scoped to
// their own creations and their accessible branches.
export async function loadMyBookings(): Promise<MyBookingRow[]> {
  const session = await currentSession();
  if (!isExternalBooker(session)) return [];
  const allowed = await getAllowedBranchIds();
  if (allowed.size === 0) return [];

  const supabase = createServiceClient();
  const { data } = await supabase
    .from('orders')
    .select(`
      id, order_no, status, service_date, branch_id,
      branch:branches!orders_branch_id_fkey ( code ),
      source:customer_sources ( name ),
      order_customers ( customer_name, seq_no ),
      order_items ( status, service_item:service_items ( name ) )
    `)
    .eq('created_by_staff_user_id', session!.staffUserId)
    .is('deleted_at', null)
    .in('branch_id', [...allowed])
    .order('service_date', { ascending: false })
    .order('order_no', { ascending: false })
    .limit(200);

  return (data ?? []).map((o) => {
    const custs = o.order_customers ?? [];
    const mainGuest = custs.slice().sort((a, b) => (a.seq_no ?? 0) - (b.seq_no ?? 0))[0]?.customer_name ?? null;
    const items = o.order_items ?? [];
    const services = items.map((it) => one(it.service_item)?.name).filter((n): n is string => !!n);
    const delivered = items.some((it) => ['in_service', 'service_completed'].includes(it.status));
    return {
      id: o.id,
      order_no: o.order_no,
      status: o.status,
      service_date: o.service_date,
      branch_code: one(o.branch)?.code ?? '—',
      source_name: one(o.source)?.name ?? null,
      guest_name: mainGuest,
      pax: custs.length,
      services,
      cancellable: !['void', 'closed'].includes(o.status) && !delivered,
    };
  });
}

// Cancel a booking the caller created, while it's still all-draft. Mirrors the
// manager-only cancelOrder body but gated by OWNERSHIP, so a booker can undo
// their own un-started booking without manager rights.
export async function cancelOwnBooking(orderId: string): Promise<{ ok: boolean; error?: string }> {
  const session = await currentSession();
  if (!isExternalBooker(session)) return { ok: false, error: 'Not authorised' };

  const supabase = await createAuditedClient();
  const { data: order } = await supabase
    .from('orders')
    .select('status, branch_id, created_by_staff_user_id')
    .eq('id', orderId)
    .maybeSingle();
  if (!order) return { ok: false, error: 'Booking not found' };
  if (order.created_by_staff_user_id !== session!.staffUserId) return { ok: false, error: 'You can only cancel your own bookings' };
  if (!(await canAccessBranch(order.branch_id))) return { ok: false, error: 'No access to this branch' };
  if (['closed', 'void'].includes(order.status)) return { ok: false, error: 'This booking can no longer be cancelled' };

  const { data: items } = await supabase.from('order_items').select('id, status').eq('order_id', orderId);
  const delivered = (items ?? []).filter((i) => ['in_service', 'service_completed'].includes(i.status));
  if (delivered.length > 0) return { ok: false, error: 'This booking has already started and cannot be cancelled — contact the branch.' };

  const draftIds = (items ?? []).filter((i) => i.status === 'draft').map((i) => i.id);
  if (draftIds.length > 0) {
    const { error: ie } = await supabase.from('order_items').update({ status: 'cancelled' }).in('id', draftIds);
    if (ie) return { ok: false, error: ie.message };
  }
  const { error } = await supabase.from('orders').update({ status: 'void' }).eq('id', orderId);
  if (error) return { ok: false, error: error.message };

  revalidatePath('/book');
  return { ok: true };
}