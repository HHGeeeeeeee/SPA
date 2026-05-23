-- Expose the auto-cancel cron job's schedule + last run to the app (the cron.*
-- tables live in the cron schema, which PostgREST can't read). SECURITY DEFINER
-- so it can read cron.* on behalf of the caller.
create or replace function public.cron_cancel_status()
returns table (schedule text, active boolean, last_start timestamptz, last_status text)
language sql
security definer
set search_path = cron, public
as $$
  select j.schedule, j.active, d.start_time, d.status
  from cron.job j
  left join lateral (
    select start_time, status
    from cron.job_run_details
    where jobid = j.jobid
    order by start_time desc
    limit 1
  ) d on true
  where j.jobname = 'cancel-stale-reservations';
$$;

grant execute on function public.cron_cancel_status() to service_role, authenticated, anon;
