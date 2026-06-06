-- Unified ERP posting from Sales Remittance: when a shift closes, its folio
-- lines (revenue / payment / refund / tip / settle) are aggregated by
-- transaction_code into ONE GL journal pushed to Acumatica. The shift row carries
-- the posting lifecycle, mirroring the other ERP-posted entities (orders /
-- revenue_soa / tip_settlements).
alter table shifts
  add column if not exists posting_status text,
  add column if not exists gl_batch_nbr text,
  add column if not exists posting_error text;
