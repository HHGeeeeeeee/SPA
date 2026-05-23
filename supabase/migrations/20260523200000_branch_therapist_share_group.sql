-- Therapist sharing: branches that carry the same non-null label share a
-- therapist pool, so they can borrow each other's therapists (cross-branch).
-- Configured per branch in Settings → Branches.
alter table public.branches
  add column if not exists therapist_share_group text;

comment on column public.branches.therapist_share_group is
  'Branches with the same non-null label share a therapist pool (cross-branch borrowing). NULL = no sharing.';
