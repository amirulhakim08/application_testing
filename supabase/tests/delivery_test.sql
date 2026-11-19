-- Phase 3: delivery orders. Runs after sales_test.sql.
\set ON_ERROR_STOP on
set client_min_messages = warning;
\o /dev/null
select set_config('test.org_a', (select id::text from public.organizations where created_by = '11111111-1111-1111-1111-111111111111'), false);
select set_config('test.year', to_char(public.today_kl(), 'YYMMDD'), false);
select set_config('test.inv', (select id::text from public.invoices where organization_id = current_setting('test.org_a')::uuid and quotation_id is not null limit 1), false);
\o

set role authenticated;
\o /dev/null
select set_config('request.jwt.claim.sub', '11111111-1111-1111-1111-111111111111', false);
select set_config('test.do', public.create_delivery_order_from('invoice', current_setting('test.inv')::uuid)::text, false);
\o
do $$
declare d record;
begin
  select * into d from public.delivery_orders where id = current_setting('test.do')::uuid;
  assert d.status = 'draft' and d.number is null, 'draft DO without number';
  assert d.invoice_id = current_setting('test.inv')::uuid, 'linked to invoice';
  assert d.delivery_address = 'Kajang', 'address copied from customer';
  assert (select count(*) from public.delivery_order_items where delivery_order_id = d.id) = 2, 'items copied';
end $$;

-- Edit the draft (partial delivery: 1 of 2 units)
\o /dev/null
select public.save_delivery_order(current_setting('test.org_a')::uuid, current_setting('test.do')::uuid, jsonb_build_object(
  'customer_id', 'c0000000-0000-0000-0000-00000000000a', 'delivery_address', 'Gudang 2, Kajang',
  'items', jsonb_build_array(jsonb_build_object('description', 'Website Development', 'quantity', 1, 'unit', 'page'))));
select public.issue_delivery_order(current_setting('test.do')::uuid);
\o
do $$
declare d record;
begin
  select * into d from public.delivery_orders where id = current_setting('test.do')::uuid;
  assert d.status = 'issued' and d.number = 'DO-' || current_setting('test.year') || '001', 'issued number ' || coalesce(d.number, 'null');
  assert d.customer_snapshot ->> 'name' is not null, 'customer snapshot';
  begin
    perform public.save_delivery_order(current_setting('test.org_a')::uuid, d.id, '{"items": [{"description": "x", "quantity": 1}]}'::jsonb);
    raise exception 'issued DO edited';
  exception when check_violation then null;
  end;
  perform public.mark_delivery_delivered(d.id, public.today_kl(), 'Encik Ali', 'Diterima dalam keadaan baik');
  assert (select status from public.delivery_orders where id = d.id) = 'delivered', 'delivered';
  assert (select received_by from public.delivery_orders where id = d.id) = 'Encik Ali', 'receiver recorded';
  begin
    perform public.cancel_delivery_order(d.id, 'x');
    raise exception 'delivered DO cancelled';
  exception when check_violation then null;
  end;
  -- The invoice is untouched by deliveries
  assert (select total from public.invoices where id = current_setting('test.inv')::uuid) = 453.00, 'invoice unchanged';
end $$;

-- Other business sees nothing and cannot act
\o /dev/null
select set_config('request.jwt.claim.sub', '22222222-2222-2222-2222-222222222222', false);
\o
do $$ begin
  assert (select count(*) from public.delivery_orders) = 0, 'B cannot see A delivery orders';
  assert (select count(*) from public.delivery_order_items) = 0, 'B cannot see A DO items';
  begin
    perform public.create_delivery_order_from('invoice', current_setting('test.inv')::uuid);
    raise exception 'B created DO from A invoice';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.issue_delivery_order(current_setting('test.do')::uuid);
    raise exception 'B touched A DO';
  exception when insufficient_privilege then null;
  end;
end $$;
reset role;
select 'ALL DELIVERY ORDER TESTS PASSED' as result;
