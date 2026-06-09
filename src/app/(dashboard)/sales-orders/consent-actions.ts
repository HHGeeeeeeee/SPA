'use server';

import { revalidatePath } from 'next/cache';

import { createServiceClient, createAuditedClient } from '@/lib/supabase/server';
import { currentSession } from '@/lib/auth';
import { canAccessBranch } from '@/lib/branch-access';
import { HEALTH_KEYS, type HealthKey } from '@/lib/i18n/kiosk';

export type ActionResult<T = unknown> =
  | { ok: true; data?: T }
  | { ok: false; error: string };

export interface ConsentSummary {
  id: string;
  name: string;
  age: number | null;
  gender: string | null;
  pressure: string | null;
  service_note: string | null;
  language: string;
  signed_at: string;
  health: Record<HealthKey, boolean>;
  health_note: string | null;
}

function toHealth(j: unknown): Record<HealthKey, boolean> {
  const obj = (j ?? {}) as Record<string, unknown>;
  return Object.fromEntries(HEALTH_KEYS.map((k) => [k, obj[k] === true])) as Record<HealthKey, boolean>;
}

// The branch's pending pool: unbound forms signed in the last 2 days, newest
// first. Any signed-in staff with access to the branch can see it.
export async function listUnboundConsents(branchId: string): Promise<ConsentSummary[]> {
  const session = await currentSession();
  if (!session) return [];
  if (!(await canAccessBranch(branchId))) return [];

  const sb = createServiceClient();
  const since = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString();
  const { data } = await sb
    .from('intake_consent')
    .select('id, name, age, gender, pressure, service_note, language, signed_at, health, health_note')
    .eq('branch_id', branchId)
    .eq('status', 'unbound')
    .gte('signed_at', since)
    .order('signed_at', { ascending: false })
    .limit(100);

  return (data ?? []).map((c) => ({
    id: c.id,
    name: c.name,
    age: c.age,
    gender: c.gender,
    pressure: c.pressure,
    service_note: c.service_note,
    language: c.language,
    signed_at: c.signed_at,
    health: toHealth(c.health),
    health_note: c.health_note,
  }));
}

export interface ConsentDetail extends ConsentSummary {
  email: string | null;
  phone: string | null;
  nationality: string | null;
  hotel: string | null;
  consent_text: string;
  template_version: string;
  signature_url: string | null;
}

export async function getConsentDetail(consentId: string): Promise<ConsentDetail | null> {
  const session = await currentSession();
  if (!session) return null;

  const sb = createServiceClient();
  const { data: c } = await sb
    .from('intake_consent')
    .select('*')
    .eq('id', consentId)
    .maybeSingle();
  if (!c) return null;
  if (!(await canAccessBranch(c.branch_id))) return null;

  // Short-lived signed URL for the private signature object.
  let signature_url: string | null = null;
  if (c.signature_path) {
    const { data: signed } = await sb.storage
      .from('intake-signatures')
      .createSignedUrl(c.signature_path, 600);
    signature_url = signed?.signedUrl ?? null;
  }

  return {
    id: c.id,
    name: c.name,
    age: c.age,
    gender: c.gender,
    pressure: c.pressure,
    service_note: c.service_note,
    language: c.language,
    signed_at: c.signed_at,
    health: toHealth(c.health),
    health_note: c.health_note,
    email: c.email,
    phone: c.phone,
    nationality: c.nationality,
    hotel: c.hotel,
    consent_text: c.consent_text,
    template_version: c.template_version,
    signature_url,
  };
}

// Attach an unbound consent to a specific order guest line.
export async function bindConsent(
  consentId: string,
  orderId: string,
  orderCustomerId: string,
): Promise<ActionResult> {
  const session = await currentSession();
  if (!session) return { ok: false, error: 'Not signed in' };

  const sb = createServiceClient();
  const [{ data: consent }, { data: order }, { data: guest }] = await Promise.all([
    sb.from('intake_consent').select('id, branch_id, status').eq('id', consentId).maybeSingle(),
    sb.from('orders').select('id, branch_id').eq('id', orderId).maybeSingle(),
    sb.from('order_customers').select('id, order_id').eq('id', orderCustomerId).maybeSingle(),
  ]);

  if (!consent) return { ok: false, error: 'Consent form not found' };
  if (!order) return { ok: false, error: 'Order not found' };
  if (!guest || guest.order_id !== orderId) return { ok: false, error: 'Guest does not belong to this order' };
  if (consent.status !== 'unbound') return { ok: false, error: 'This form is already linked' };
  if (consent.branch_id !== order.branch_id) return { ok: false, error: 'Form was signed at a different branch' };
  if (!(await canAccessBranch(order.branch_id))) return { ok: false, error: 'No access to this branch' };

  const audited = await createAuditedClient();
  const { error } = await audited
    .from('intake_consent')
    .update({
      status: 'bound',
      order_id: orderId,
      order_customer_id: orderCustomerId,
      bound_at: new Date().toISOString(),
      bound_by_staff_user_id: session.staffUserId,
    })
    .eq('id', consentId)
    .eq('status', 'unbound'); // guard against a race
  if (error) return { ok: false, error: error.message };

  revalidatePath(`/sales-orders/${orderId}`);
  return { ok: true };
}

// Detach a consent back to the pending pool (e.g. attached to the wrong guest).
export async function unbindConsent(consentId: string): Promise<ActionResult> {
  const session = await currentSession();
  if (!session) return { ok: false, error: 'Not signed in' };

  const sb = createServiceClient();
  const { data: consent } = await sb
    .from('intake_consent')
    .select('id, branch_id, order_id')
    .eq('id', consentId)
    .maybeSingle();
  if (!consent) return { ok: false, error: 'Consent form not found' };
  if (!(await canAccessBranch(consent.branch_id))) return { ok: false, error: 'No access to this branch' };

  const audited = await createAuditedClient();
  const { error } = await audited
    .from('intake_consent')
    .update({ status: 'unbound', order_id: null, order_customer_id: null, bound_at: null, bound_by_staff_user_id: null })
    .eq('id', consentId);
  if (error) return { ok: false, error: error.message };

  if (consent.order_id) revalidatePath(`/sales-orders/${consent.order_id}`);
  return { ok: true };
}
