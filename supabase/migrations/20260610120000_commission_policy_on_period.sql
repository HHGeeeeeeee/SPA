-- Record which commission policy was used when settling a period.
-- Branch default is a proposal; managers can override at settlement time.
-- Legacy periods (settled before this column) stay NULL.
alter table public.commission_periods
  add column if not exists commission_policy_id uuid references public.commission_policies(id);
