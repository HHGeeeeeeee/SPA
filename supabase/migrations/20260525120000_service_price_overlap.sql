-- Effective-dated service prices: a service item now keeps a timeline of price
-- segments ([effective_from, effective_to]) instead of a single row, so prices
-- can be scheduled ahead and old prices stay as history. Guard against
-- overlapping segments for the same (service item, price class, branch).
--
-- branch_id NULL = the all-branch price; coalesce it to a sentinel UUID so the
-- exclusion treats two NULL-branch rows as the same branch (NULL = NULL would
-- otherwise be unknown and let them overlap).
CREATE EXTENSION IF NOT EXISTS btree_gist;

ALTER TABLE public.service_item_prices
  ADD CONSTRAINT no_service_price_period_overlap
  EXCLUDE USING gist (
    service_item_id WITH =,
    price_class WITH =,
    COALESCE(branch_id, '00000000-0000-0000-0000-000000000000'::uuid) WITH =,
    daterange(effective_from, effective_to, '[]') WITH &&
  );
