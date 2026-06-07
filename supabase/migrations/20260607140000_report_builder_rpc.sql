-- Report Builder: dynamic group-by aggregation over the order_items fact.
--
-- WHY a Postgres function (the codebase otherwise aggregates in TypeScript):
-- the Report Builder lets the user pick any combination of dimensions to group
-- by. Doing that in JS means pulling every raw order_items row to the server and
-- folding it there — which (a) trips PostgREST's 1000-row return cap and needs
-- manual pagination, and (b) ships tens of thousands of rows over the wire for a
-- report that is a few hundred grouped rows. Pushing the GROUP BY into Postgres
-- scans server-side (no row cap) and returns the aggregated result as a single
-- jsonb value (one row), so the 1000-row limit never applies.
--
-- SAFETY (dynamic SQL): the grouping columns are built by dynamic SQL, so the
-- only defence against injection is the whitelist `v_expr_map` below. The caller
-- supplies dimension KEYS only; each key is looked up to a hard-coded SQL
-- expression and an unknown key raises. No caller-supplied string ever reaches
-- the SQL text — values flow through EXECUTE ... USING bind params instead.

create or replace function public.report_revenue(
  p_from         date,
  p_to           date,
  p_dimensions   text[],   -- ordered dimension keys to group by (may be empty → grand total)
  p_statuses     text[],   -- order_items.status filter (UI defaults to excluding 'cancelled')
  p_branch_ids   uuid[],   -- access scope + filter, applied to the ORDER branch (orders.branch_id)
  p_settled_only boolean default false  -- true → commission counts only settled lines
) returns jsonb
language plpgsql
stable
as $$
declare
  -- Whitelist: dimension key → SQL expression yielding a human-readable label.
  -- This is the ONLY place a dimension can come from; anything not here is rejected.
  v_expr_map jsonb := jsonb_build_object(
    'order_branch',   'ob.name',
    'station_branch', 'sb.name',
    'source',         'cs.name',
    'category',       'sc.name',
    'service',        'si.name',
    'therapist',      'emp.name',
    'station',        'r.resource_name',
    'status',         'oi.status',
    'scheduled_hour', 'extract(hour from oi.scheduled_start)::int',
    'service_date',   'o.service_date::text',
    'duration',       'oi.duration_minutes'
  );
  v_key        text;
  v_expr       text;
  v_selects    text[] := array[]::text[];  -- "<expr> as <key>" per chosen dimension
  v_groupexprs text[] := array[]::text[];  -- "<expr>" per chosen dimension
  v_comm_expr  text;
  v_sql        text;
  v_result     jsonb;
begin
  if p_dimensions is not null then
    foreach v_key in array p_dimensions loop
      v_expr := v_expr_map ->> v_key;
      if v_expr is null then
        raise exception 'unknown report dimension: %', v_key;
      end if;
      v_selects    := v_selects    || format('%s as %I', v_expr, v_key);
      v_groupexprs := v_groupexprs || v_expr;
    end loop;
  end if;

  -- settled-only changes the commission AGGREGATE, never the row filter — else
  -- unsettled lines would drop out of sales/discount/net too.
  v_comm_expr := case when p_settled_only
    then 'sum(case when oi.commission_settlement_id is not null then coalesce(oi.commission_amount_cents,0) else 0 end)'
    else 'sum(coalesce(oi.commission_amount_cents,0))'
  end;

  v_sql := format($q$
    select coalesce(jsonb_agg(t order by t), '[]'::jsonb)
    from (
      select %s
             count(*)                                  as line_count,
             sum(coalesce(oi.list_price_cents,0))      as sales_cents,
             sum(coalesce(oi.discount_amount_cents,0)) as discount_cents,
             sum(coalesce(oi.final_amount_cents,0))    as net_cents,
             %s                                        as commission_cents,
             sum(coalesce(oi.final_amount_cents,0)) - (%s) as net_of_commission_cents
      from public.order_items oi
      join public.orders o on o.id = oi.order_id
      left join public.branches           ob  on ob.id  = o.branch_id
      left join public.resources          r   on r.id   = oi.resource_id
      left join public.branches           sb  on sb.id  = r.branch_id
      left join public.customer_sources   cs  on cs.id  = o.source_id
      left join public.service_categories sc  on sc.id  = oi.service_category_id
      left join public.service_items      si  on si.id  = oi.service_item_id
      left join public.employees          emp on emp.id = oi.therapist_id
      where o.service_date between $1 and $2
        and o.deleted_at is null
        and o.status <> 'void'
        and o.branch_id = any($3)
        and oi.status   = any($4)
      %s
    ) t
  $q$,
    case when array_length(v_selects, 1) is null then '' else array_to_string(v_selects, ', ') || ',' end,
    v_comm_expr,  -- commission_cents
    v_comm_expr,  -- net_of_commission_cents subtracts the same (settled-aware) commission
    case when array_length(v_groupexprs, 1) is null then '' else 'group by ' || array_to_string(v_groupexprs, ', ') end
  );

  execute v_sql into v_result using p_from, p_to, p_branch_ids, p_statuses;
  return coalesce(v_result, '[]'::jsonb);
end;
$$;

grant execute on function public.report_revenue(date, date, text[], text[], uuid[], boolean)
  to authenticated, service_role;