-- Who created the order. Until now the creator was only recoverable from the
-- audit_log; the external_booker /book page needs a direct, indexable filter to
-- show "my bookings", so denormalise the creating staff user onto the order.
-- createOrderDirect() sets this; other order-creation paths may leave it null.

alter table public.orders
  add column if not exists created_by_staff_user_id uuid references public.staff_users(id);

create index if not exists idx_orders_created_by
  on public.orders(created_by_staff_user_id);