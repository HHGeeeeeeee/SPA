-- Two more guest-entered fields on the kiosk intake form: nationality and the
-- hotel the guest is staying at (both free-text, optional).

alter table public.intake_consent
  add column if not exists nationality text,
  add column if not exists hotel text;
