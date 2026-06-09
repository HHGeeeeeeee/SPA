'use server';

import { randomUUID } from 'crypto';
import bcrypt from 'bcryptjs';
import { z } from 'zod';

import { createServiceClient } from '@/lib/supabase/server';
import { setKioskCookie, readKioskContext, clearKioskCookie } from '@/lib/kiosk-session';
import { KIOSK_DICTS, KIOSK_LOCALES, HEALTH_KEYS, TEMPLATE_VERSION } from '@/lib/i18n/kiosk';

export type ActionResult<T = unknown> =
  | { ok: true; data?: T }
  | { ok: false; error: string };

export interface KioskBranchOpt {
  id: string;
  code: string;
  name: string;
}

// Public: list active branches for the ARM screen dropdown. No session — the
// branch list isn't sensitive, and arming still requires the branch passcode.
export async function listKioskBranches(): Promise<KioskBranchOpt[]> {
  const sb = createServiceClient();
  const { data } = await sb
    .from('branches')
    .select('id, code, name')
    .eq('active', true)
    .order('code');
  return data ?? [];
}

// Arm the tablet to a branch after verifying that branch's kiosk passcode.
export async function armKiosk(branchId: string, passcode: string): Promise<ActionResult> {
  if (!branchId || !passcode) return { ok: false, error: 'Pick a branch and enter the passcode' };

  const sb = createServiceClient();
  const { data: branch } = await sb
    .from('branches')
    .select('id, code, name, active, kiosk_passcode_hash')
    .eq('id', branchId)
    .maybeSingle();

  if (!branch || !branch.active) return { ok: false, error: 'Branch not found' };
  if (!branch.kiosk_passcode_hash) {
    return { ok: false, error: 'No kiosk passcode set for this branch — set one in Settings → Branches.' };
  }
  const match = await bcrypt.compare(passcode, branch.kiosk_passcode_hash);
  if (!match) return { ok: false, error: 'Wrong passcode' };

  await setKioskCookie({ branchId: branch.id, branchCode: branch.code, branchName: branch.name });
  return { ok: true };
}

// Exit kiosk mode — requires the armed branch's passcode again so a guest can't
// leave the loop or re-point the tablet.
export async function exitKiosk(passcode: string): Promise<ActionResult> {
  const ctx = await readKioskContext();
  if (!ctx) {
    await clearKioskCookie();
    return { ok: true };
  }
  const sb = createServiceClient();
  const { data: branch } = await sb
    .from('branches')
    .select('kiosk_passcode_hash')
    .eq('id', ctx.branchId)
    .maybeSingle();
  if (branch?.kiosk_passcode_hash && !(await bcrypt.compare(passcode, branch.kiosk_passcode_hash))) {
    return { ok: false, error: 'Wrong passcode' };
  }
  await clearKioskCookie();
  return { ok: true };
}

const submitSchema = z.object({
  name: z.string().trim().min(1).max(120),
  email: z.string().trim().max(160).optional().nullable(),
  phone: z.string().trim().max(40).optional().nullable(),
  age: z.number().int().min(0).max(149).optional().nullable(),
  gender: z.enum(['male', 'female', 'other']).optional().nullable(),
  nationality: z.string().trim().max(80).optional().nullable(),
  hotel: z.string().trim().max(120).optional().nullable(),
  serviceNote: z.string().trim().max(500).optional().nullable(),
  pressure: z.enum(['soft', 'medium', 'hard']),
  health: z.record(z.string(), z.boolean()),
  healthNote: z.string().trim().max(1000).optional().nullable(),
  language: z.enum(KIOSK_LOCALES),
  agree: z.literal(true),
  // A PNG data URL produced by the signature canvas.
  signatureDataUrl: z.string().startsWith('data:image/png;base64,').max(3_000_000),
});

export type KioskSubmitInput = z.input<typeof submitSchema>;

export async function submitIntake(input: KioskSubmitInput): Promise<ActionResult> {
  const ctx = await readKioskContext();
  if (!ctx) return { ok: false, error: 'This tablet is no longer set up. Please call the front desk.' };

  const parsed = submitSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? 'Invalid submission' };
  }
  const v = parsed.data;

  // Keep only the known health keys; coerce to booleans.
  const health: Record<string, boolean> = {};
  for (const k of HEALTH_KEYS) health[k] = v.health[k] === true;

  // Snapshot the consent text server-side from the locale the guest signed in —
  // never trust client-supplied legal text.
  const consentText = KIOSK_DICTS[v.language].consentText;

  const sb = createServiceClient();

  // Upload signature to the private bucket first; store only its object key.
  const base64 = v.signatureDataUrl.slice('data:image/png;base64,'.length);
  const buf = Buffer.from(base64, 'base64');
  const path = `${ctx.branchId}/${randomUUID()}.png`;
  const up = await sb.storage
    .from('intake-signatures')
    .upload(path, buf, { contentType: 'image/png', upsert: false });
  if (up.error) return { ok: false, error: up.error.message };

  const { error } = await sb.from('intake_consent').insert({
    branch_id: ctx.branchId,
    status: 'unbound',
    name: v.name,
    email: v.email?.trim() || null,
    phone: v.phone?.trim() || null,
    age: v.age ?? null,
    gender: v.gender ?? null,
    nationality: v.nationality?.trim() || null,
    hotel: v.hotel?.trim() || null,
    service_note: v.serviceNote?.trim() || null,
    pressure: v.pressure,
    health,
    health_note: v.healthNote?.trim() || null,
    signature_path: path,
    language: v.language,
    template_version: TEMPLATE_VERSION,
    consent_text: consentText,
  });
  if (error) {
    // Best-effort cleanup of the orphaned signature object.
    await sb.storage.from('intake-signatures').remove([path]);
    return { ok: false, error: error.message };
  }

  return { ok: true };
}
