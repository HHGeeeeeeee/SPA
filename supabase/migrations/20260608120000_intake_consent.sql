-- Guest intake / health questionnaire + consent, captured on the in-branch
-- kiosk tablet (public, no-login, gated by a per-branch passcode). A signed
-- record is born UNBOUND — it belongs to no order yet. Staff later bind it to a
-- specific order guest line (order_customers row) from the order detail page.
--
-- Design notes:
--  * Immutable legal snapshot: once signed we keep consent_text + answers as the
--    guest saw them. "Re-sign" = void this row + insert a fresh one, never edit.
--  * Re-sign every visit → a consent is effectively 1:1 with an order guest line.
--  * answers are stored under stable language-neutral keys (health jsonb), so the
--    8-locale UI only swaps labels — data + reports are unaffected.
--  * signature image lives in the private `intake-signatures` storage bucket;
--    only signature_path (the object key) is stored here.

create table public.intake_consent (
  id                       uuid primary key default gen_random_uuid(),
  branch_id                uuid not null references public.branches(id),

  -- Binding: null until staff attach it to an order guest line.
  status                   text not null default 'unbound'
                             check (status in ('unbound', 'bound', 'voided')),
  order_id                 uuid references public.orders(id) on delete set null,
  order_customer_id        uuid references public.order_customers(id) on delete set null,

  -- Guest-entered identity / preference.
  name                     text not null,
  email                    text,
  phone                    text,
  age                      integer check (age is null or (age >= 0 and age < 150)),
  gender                   text check (gender in ('male', 'female', 'other', 'na')),
  service_note             text,
  pressure                 text check (pressure in ('soft', 'medium', 'hard')),

  -- Health declaration: stable keys (pregnant / cardiac / injury / skin / allergy)
  -- → boolean. health_note carries the free-text "please explain".
  health                   jsonb not null default '{}'::jsonb,
  health_note              text,

  -- Signed snapshot.
  signature_path           text not null,
  language                 text not null,            -- locale the guest read/agreed in
  template_version         text not null default 'v1',
  consent_text             text not null,            -- the exact consent paragraph agreed to
  signed_at                timestamptz not null default now(),

  -- Set when staff bind / re-bind.
  bound_at                 timestamptz,
  bound_by_staff_user_id   uuid references public.staff_users(id),

  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now()
);

-- The kiosk pool lookup: "today's unbound forms for this branch", newest first.
create index idx_intake_consent_pool
  on public.intake_consent(branch_id, status, signed_at desc);
-- Reverse lookup from an order guest line to its consent(s).
create index idx_intake_consent_order_customer
  on public.intake_consent(order_customer_id);

create trigger trg_intake_consent_updated before update on public.intake_consent
  for each row execute function public.touch_updated_at();

-- Audit who bound / voided a consent (the signing itself is a public insert).
drop trigger if exists zz_audit_trg on public.intake_consent;
create trigger zz_audit_trg after insert or update or delete on public.intake_consent
  for each row execute function public.audit_capture();

alter table public.intake_consent enable row level security;

-- Per-branch kiosk passcode (bcrypt hash). Null = kiosk not armable for this
-- branch. Set from the branch master-data form.
alter table public.branches
  add column if not exists kiosk_passcode_hash text;

-- Private bucket for signature PNGs — server-role uploads + short-lived signed
-- URLs only, never public. Mirrors the ar-proofs bucket.
insert into storage.buckets (id, name, public)
values ('intake-signatures', 'intake-signatures', false)
on conflict (id) do nothing;
