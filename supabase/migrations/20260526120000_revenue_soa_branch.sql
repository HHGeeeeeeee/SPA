-- A statement of account always covers exactly one branch (generation groups by
-- billing × branch). Denormalize that branch onto revenue_soa so AR-balance can
-- be scoped per branch without joining through orders, and the PDF/History can
-- name the branch directly.
alter table public.revenue_soa
  add column if not exists branch_id uuid references public.branches(id);

-- Backfill from the orders already stated on each SOA (all share one branch).
update public.revenue_soa s
set branch_id = sub.branch_id
from (
  select rso.soa_id, min(o.branch_id::text)::uuid as branch_id
  from public.revenue_soa_orders rso
  join public.orders o on o.id = rso.order_id
  group by rso.soa_id
) sub
where sub.soa_id = s.id
  and s.branch_id is null;

create index if not exists idx_revenue_soa_branch on public.revenue_soa (branch_id);
