-- folio_lines replaced the retired payments table (20260605) but never got the
-- audit trigger, so payments/refunds left no trace in the order change history.
-- Attach the same best-effort audit_capture trigger the other money tables use.
DROP TRIGGER IF EXISTS zz_audit_trg ON public.folio_lines;
CREATE TRIGGER zz_audit_trg AFTER INSERT OR UPDATE OR DELETE ON public.folio_lines
  FOR EACH ROW EXECUTE FUNCTION public.audit_capture();
