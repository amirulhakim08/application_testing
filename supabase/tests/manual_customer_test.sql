-- Customer details typed by hand (not in the customer list). Runs after cash_sale_test.sql.
\set ON_ERROR_STOP on
set client_min_messages = warning;
\o /dev/null
select set_config('test.org_a', (select id::text from public.organizations where created_by = '11111111-1111-1111-1111-111111111111'), false);
\o
set role authenticated;
select set_config('request.jwt.claim.sub', '11111111-1111-1111-1111-111111111111', false) \g /dev/null
do $$
declare
  v_customers int := (select count(*) from public.customers);
  v_q uuid; v_inv uuid; v_no text; v_do uuid; q record; i record; d record; s record;
  v_manual jsonb := '{"name":"  Puan Siti  ","phone":"012-3456789","billing_address":"Lot 5, Bangi","email":""}';
  v_items jsonb := '[{"description":"Kek coklat","quantity":1,"unit_price":80}]';
begin
  v_q := public.save_quotation(current_setting('test.org_a')::uuid, null,
    jsonb_build_object('customer_manual', v_manual, 'items', v_items));
  select * into q from public.quotations where id = v_q;
  assert q.customer_id is null and q.customer_snapshot ->> 'name' = 'Puan Siti', 'manual name stored on the quotation';
  assert q.customer_snapshot ->> 'email' is null, 'blank fields dropped';
  assert (select count(*) from public.customers) = v_customers, 'customer list unchanged';
  perform public.set_quotation_status(v_q, 'sent');
  v_inv := public.convert_quotation_to_invoice(v_q);
  select * into i from public.invoices where id = v_inv;
  assert i.customer_id is null and i.customer_snapshot ->> 'phone' = '012-3456789', 'manual details carried to invoice';
  v_no := public.issue_invoice(v_inv);
  select * into i from public.invoices where id = v_inv;
  assert i.status = 'issued' and i.customer_snapshot ->> 'name' = 'Puan Siti', 'issued with manual customer';
  v_do := public.create_delivery_order_from('invoice', v_inv);
  select * into d from public.delivery_orders where id = v_do;
  assert d.delivery_address = 'Lot 5, Bangi' and d.customer_snapshot ->> 'name' = 'Puan Siti', 'DO copies manual details';
  perform public.issue_delivery_order(v_do);
  -- Picking a listed customer on a draft clears the typed details
  v_q := public.save_quotation(current_setting('test.org_a')::uuid, null, jsonb_build_object('customer_manual', v_manual, 'items', v_items));
  perform public.save_quotation(current_setting('test.org_a')::uuid, v_q, jsonb_build_object('customer_id', 'c0000000-0000-0000-0000-00000000000a', 'customer_manual', v_manual, 'items', v_items));
  select * into q from public.quotations where id = v_q;
  assert q.customer_id is not null and q.customer_snapshot is null, 'listed customer wins over typed details';
  -- No customer at all still cannot be issued
  v_inv := public.save_invoice(current_setting('test.org_a')::uuid, null, jsonb_build_object('items', v_items));
  begin
    perform public.issue_invoice(v_inv);
    raise exception 'issued without any customer';
  exception when check_violation then null;
  end;
  -- Direct sale with typed customer
  select sale_id into v_do from public.record_cash_sale(current_setting('test.org_a')::uuid,
    jsonb_build_object('customer_manual', v_manual, 'items', v_items), gen_random_uuid());
  select * into s from public.cash_sales where id = v_do;
  assert s.customer_id is null and s.customer_snapshot ->> 'name' = 'Puan Siti', 'direct sale keeps typed customer';
end $$;
reset role;
select 'ALL MANUAL CUSTOMER TESTS PASSED' as result;
