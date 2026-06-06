-- The SOA settle line is a folio line now (kind=payment, order_id null,
-- soa_session_id set). Third-party settlements still want a proof attachment
-- (cash photo / remittance slip), so give every folio line an optional proof
-- path — the settle line carries its own evidence, ERP is derived later from
-- the folio ledger via Sales Remittance (no per-settle GL push anymore).
alter table folio_lines
  add column if not exists proof_file_path text;
