-- Retire the no-show auto-cancel cron + its status function. No-show handling
-- now lives solely in End of Day -> Step 1 (Order Review). Beds are freed
-- independently by the 30-minute overdue release, so nothing here touches beds.
do $$
begin
  if exists (select 1 from cron.job where jobname = 'cancel-stale-reservations') then
    perform cron.unschedule('cancel-stale-reservations');
  end if;
end $$;

drop function if exists public.cron_cancel_status();
drop function if exists public.cancel_stale_reservations();
