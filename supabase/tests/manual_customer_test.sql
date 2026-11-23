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

-- Payment proofs (migration 0010)
set role authenticated;
select set_config('request.jwt.claim.sub', '11111111-1111-1111-1111-111111111111', false) \g /dev/null
do $$
declare v_pay uuid; v_org uuid := current_setting('test.org_a')::uuid; v_path text;
begin
  select payment_id into v_pay from public.record_payment(v_org, null, null, 12.00, public.today_kl(), 'duitnow', 'REF1', 'Proof test', null, gen_random_uuid());
  v_path := v_org || '/' || v_pay || '/proof.jpg';
  assert public.storage_payment_proof_ok(v_path), 'member may upload to own payment folder';
  assert not public.storage_payment_proof_ok(v_org || '/' || v_pay || '/../x.jpg'), 'no path tricks';
  assert not public.storage_payment_proof_ok(v_org || '/' || gen_random_uuid() || '/x.jpg'), 'unknown payment refused';
  begin
    perform public.attach_payment_proof(v_pay, 'someone/else.jpg');
    raise exception 'foreign path accepted';
  exception when check_violation then null;
  end;
  perform public.attach_payment_proof(v_pay, v_path);
  perform public.attach_payment_proof(v_pay, v_path); -- retry is fine
  assert (select proof_path from public.payments where id = v_pay) = v_path, 'proof linked';
  assert not public.storage_payment_proof_ok(v_path), 'no second upload once linked';
  begin
    perform public.attach_payment_proof(v_pay, v_org || '/' || v_pay || '/other.jpg');
    raise exception 'proof replaced';
  exception when check_violation then null;
  end;
  perform set_config('test.proof_pay', v_pay::text, false);
end $$;
select set_config('request.jwt.claim.sub', '22222222-2222-2222-2222-222222222222', false) \g /dev/null
do $$
begin
  assert not public.storage_payment_proof_ok(current_setting('test.org_a') || '/' || current_setting('test.proof_pay') || '/x.jpg'), 'B cannot upload to A';
  begin
    perform public.attach_payment_proof(current_setting('test.proof_pay')::uuid, 'x');
    raise exception 'B attached to A';
  exception when insufficient_privilege or no_data_found then null;
  end;
end $$;
reset role;
select 'ALL PAYMENT PROOF TESTS PASSED' as result;

-- Correct / delete receipts (migration 0011)
set role authenticated;
select set_config('request.jwt.claim.sub', '11111111-1111-1111-1111-111111111111', false) \g /dev/null
do $$
declare v_org uuid := current_setting('test.org_a')::uuid; r1 record; r2 record; v_items jsonb := '[{"description":"Nasi lemak","quantity":2,"unit_price":5}]';
  v_proof text;
begin
  select * into r1 from public.record_cash_sale(v_org, jsonb_build_object('items', v_items), gen_random_uuid());
  -- Correct it: new receipt issued, old one voided in the same call
  select * into r2 from public.record_cash_sale(v_org,
    jsonb_build_object('items', '[{"description":"Nasi lemak ayam","quantity":2,"unit_price":6}]'::jsonb, 'replaces_payment_id', r1.payment_id), gen_random_uuid());
  assert (select voided_at is not null from public.payments where id = r1.payment_id), 'old receipt voided';
  assert (select void_reason from public.payments where id = r1.payment_id) like '%' || r2.receipt_number, 'reason names the new receipt';
  assert (select voided_at is null from public.payments where id = r2.payment_id), 'new receipt valid';
  -- Cannot correct a void receipt twice
  begin
    perform public.record_cash_sale(v_org, jsonb_build_object('items', v_items, 'replaces_payment_id', r1.payment_id), gen_random_uuid());
    raise exception 'corrected a void receipt';
  exception when check_violation then null;
  end;
  -- Delete within 24 hours (owner)
  v_proof := public.delete_payment_receipt(r2.payment_id);
  assert not exists (select 1 from public.payments where id = r2.payment_id), 'payment deleted';
  assert not exists (select 1 from public.receipts where payment_id = r2.payment_id), 'receipt deleted';
  assert not exists (select 1 from public.cash_sales where payment_id = r2.payment_id), 'sale deleted';
  perform set_config('test.old_pay', r1.payment_id::text, false);
end $$;
reset role;
-- Older than 24 hours: refused
update public.payments set created_at = now() - interval '25 hours' where id = current_setting('test.old_pay')::uuid;
set role authenticated;
do $$
begin
  perform public.delete_payment_receipt(current_setting('test.old_pay')::uuid);
  raise exception 'deleted an old receipt';
exception when check_violation then null;
end $$;
-- Another business cannot delete A's receipts
select set_config('request.jwt.claim.sub', '22222222-2222-2222-2222-222222222222', false) \g /dev/null
do $$
begin
  perform public.delete_payment_receipt(current_setting('test.old_pay')::uuid);
  raise exception 'B deleted A receipt';
exception when no_data_found or insufficient_privilege then null;
end $$;
reset role;
select 'ALL RECEIPT FIX TESTS PASSED' as result;
