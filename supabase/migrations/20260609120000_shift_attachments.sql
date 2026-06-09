-- Per-payment-method evidence attached to a shift's remittance: a cash drawer
-- photo, a credit-card settlement slip/PDF, a PAYMAYA batch report, etc. One
-- shift can carry many files, each tagged with the method it backs up.
--
-- Design notes:
--  * method_code is the lowercased payment_methods.code the file evidences
--    (e.g. 'cash', 'paymaya'), matching the rollup keys the Remittance table
--    already groups by. Not an FK — the rollup is by code, methods are seldom
--    deleted, and a stale code just shows under its own row.
--  * Files live in the private `shift-attachments` storage bucket; only the
--    object key (file_path) is stored here. Mirrors ar-proofs / intake-signatures
--    — server-role uploads + short-lived signed URLs, never public.
--  * Settlement details often arrive the day AFTER the drawer is counted, so
--    uploads are allowed on closed shifts too (the app layer gates this).

create table public.shift_attachments (
  id              uuid primary key default gen_random_uuid(),
  shift_id        uuid not null references public.shifts(id) on delete cascade,
  method_code     text not null,            -- lowercased payment_methods.code this file backs up
  file_path       text not null,            -- object key in the shift-attachments bucket
  file_name       text not null,            -- original filename, for display
  content_type    text,
  size_bytes      integer,
  uploaded_by     uuid references public.staff_users(id),
  uploaded_at     timestamptz not null default now(),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

-- The panel lookup: "all files for this shift", grouped per method, newest first.
create index idx_shift_attachments_shift
  on public.shift_attachments(shift_id, method_code, uploaded_at desc);

create trigger trg_shift_attachments_updated before update on public.shift_attachments
  for each row execute function public.touch_updated_at();

drop trigger if exists zz_audit_trg on public.shift_attachments;
create trigger zz_audit_trg after insert or update or delete on public.shift_attachments
  for each row execute function public.audit_capture();

-- App-layer RBAC (service role + branch guards) — no RLS policies, matching the
-- rest of the schema. RLS on with no policy = deny-by-default to anon/auth roles.
alter table public.shift_attachments enable row level security;

-- Private bucket for remittance evidence — server-role uploads + short-lived
-- signed URLs only, never public. Mirrors the ar-proofs bucket.
insert into storage.buckets (id, name, public)
values ('shift-attachments', 'shift-attachments', false)
on conflict (id) do nothing;
