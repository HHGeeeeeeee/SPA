-- AR / SOA re-base: the Statement of Account is no longer built from orders
-- (revenue_soa_orders junction) but from folio_lines. Accounts receivable is now
-- an explicit ar-method payment line ("掛帳"), grouped into a revenue_soa session,
-- and settled by a single session-scoped settle folio line that the per-line
-- references point back to.
--
-- Clean cut-over: revenue_soa / revenue_soa_orders / revenue_soa_payments are all
-- empty and there are no ar-method folio lines yet, so nothing needs migrating.

begin;

-- ── folio_lines: the SOA base ───────────────────────────────────────────────
-- A settle / void line belongs to a whole SOA session, not a single order, so
-- order_id must be nullable (it stays NOT NULL in practice for guest-facing
-- revenue/payment/refund/tip lines — only settle lines leave it null).
alter table folio_lines alter column order_id drop not null;

-- bill_to: which billing destination (hotel) this line is receivable from.
-- Carried from the order header onto ar-method payment/refund lines, and onto
-- the settle line.
alter table folio_lines
  add column if not exists billing_destination_id uuid references billing_destinations(id);

-- Which SOA (revenue_soa) session this line is grouped into. Set at SOA-prep for
-- the ar lines, and on the settle line itself. Permanent membership marker
-- (kept through settle/void) — distinct from settled_by below.
alter table folio_lines
  add column if not exists soa_session_id uuid references revenue_soa(id) on delete set null;

-- Self-reference: which settle folio line settled this ar line. SET on settle,
-- CLEARED (back to null) on void. This is the per-line "reference id" the SOA
-- settle binds back to all its session lines.
alter table folio_lines
  add column if not exists settled_by_folio_line_id uuid references folio_lines(id) on delete set null;

create index if not exists folio_lines_billing_destination_idx on folio_lines(billing_destination_id);
create index if not exists folio_lines_soa_session_idx on folio_lines(soa_session_id);
create index if not exists folio_lines_settled_by_idx on folio_lines(settled_by_folio_line_id);

-- ── billing_destinations: bind a single transaction code ─────────────────────
-- The bound code carries both DR and CR, so one code per destination drives both
-- the AR booking (掛帳) line and the settle line. This supersedes the direct GL
-- accounts (intercompany_account / intercompany_sub), which are left in place but
-- are no longer read by the new folio-base settle path.
alter table billing_destinations
  add column if not exists transaction_code_id uuid references transaction_codes(id);

commit;
