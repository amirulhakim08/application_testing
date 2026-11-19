-- Direct sales receipts (cash sales) and daily numbering. Runs after delivery_test.sql.
\set ON_ERROR_STOP on
set client_min_messages = warning;
\o /dev/null
select set_config('test.org_a', (select id::text from public.organizations where created_by = '11111111-1111-1111-1111-111111111111'), false);
select set_config('test.day', to_char(public.today_kl(), 'YYMMDD'), false);
select set_config('test.rc_before', (select count(*)::text from public.receipts where organization_id = current_setting('test.org_a')::uuid and number like 'RC-' || current_setting('test.day') || '%'), false);
\o

set role authenticated;
\o /dev/null
select set_config('request.jwt.claim.sub', '11111111-1111-1111-1111-111111111111', false);
select set_config('test.key', gen_random_uuid()::text, false);
-- 2 x 12.50 (6% tax) + 1 x 3.00 (no tax), 10% service charge -> 28.00 + 2.80 + 1.50 = 32.30
select set_config('test.sale', (select sale_id::text from public.record_cash_sale(current_setting('test.org_a')::uuid, jsonb_build_object(
  'sale_date', public.today_kl(), 'method', 'cash',
  'items', jsonb_build_array(
    jsonb_build_object('description', 'Nasi lemak', 'quantity', 2, 'unit_price', 12.50, 'tax_rate', 6),
    jsonb_build_object('description', 'Teh tarik', 'quantity', 1, 'unit_price', 3)),
  'charges', jsonb_build_array(jsonb_build_object('label', 'Caj perkhidmatan', 'kind', 'percent', 'value', 10))),
  current_setting('test.key')::uuid)), false);
\o
do $$
declare s record; p record; r record; v_again uuid;
begin
  select * into s from public.cash_sales where id = current_setting('test.sale')::uuid;
  assert s.subtotal = 28.00 and s.tax_total = 1.50 and s.charges_total = 2.80 and s.total = 32.30, 'cash sale totals ' || s.total;
  assert s.customer_id is null, 'walk-in sale has no customer';
  select * into p from public.payments where id = s.payment_id;
  assert p.amount = 32.30 and p.invoice_id is null and p.method = 'cash', 'payment recorded';
  assert p.description = 'Nasi lemak, Teh tarik', 'payment description ' || p.description;
  select * into r from public.receipts where payment_id = p.id;
  assert r.number = 'RC-' || current_setting('test.day') || lpad((current_setting('test.rc_before')::int + 1)::text, 3, '0'),
    'daily receipt number ' || r.number;
  assert (select count(*) from public.cash_sale_items where cash_sale_id = s.id) = 2, 'items saved';
  -- Same request key: same sale, nothing new
  select sale_id into v_again from public.record_cash_sale(current_setting('test.org_a')::uuid,
    '{"items":[{"description":"x","quantity":1,"unit_price":1}]}'::jsonb, current_setting('test.key')::uuid);
  assert v_again = s.id, 'idempotent';
  assert (select count(*) from public.cash_sales) = 1, 'no duplicate sale';
  -- Members have no direct write access
  update public.cash_sales set total = 1 where id = s.id;
  assert (select total from public.cash_sales where id = s.id) = 32.30, 'member edited a sale';
  -- Zero total is refused
  begin
    perform public.record_cash_sale(current_setting('test.org_a')::uuid,
      '{"items":[{"description":"Free","quantity":1,"unit_price":0}]}'::jsonb, gen_random_uuid());
    raise exception 'zero sale accepted';
  exception when check_violation then null;
  end;
  -- Voiding the payment voids the receipt; the sale stays for audit
  perform public.void_payment(p.id, 'Salah harga');
  assert (select voided_at is not null from public.receipts where payment_id = p.id), 'receipt voided';
  assert exists (select 1 from public.cash_sales where id = s.id), 'sale kept';
end $$;

-- Daily number format for every document type
do $$
declare v text;
begin
  v := public.next_document_number(current_setting('test.org_a')::uuid, 'quotation', date '2026-10-23');
  raise exception 'members must not call next_document_number directly (%).', v;
exception when insufficient_privilege then null;
end $$;
reset role;
do $$
declare v1 text; v2 text;
begin
  -- Even the owner role cannot edit an issued receipt (trigger)
  begin
    update public.cash_sales set total = 1 where id = current_setting('test.sale')::uuid;
    raise exception 'cash sale was edited';
  exception when check_violation then null;
  end;
  v1 := public.next_document_number(current_setting('test.org_a')::uuid, 'quotation', date '2026-10-23');
  v2 := public.next_document_number(current_setting('test.org_a')::uuid, 'quotation', date '2026-10-23');
  assert v1 = 'QT-261023001' and v2 = 'QT-261023002', 'daily format ' || v1 || ' ' || v2;
  assert public.next_document_number(current_setting('test.org_a')::uuid, 'quotation', date '2026-10-24') = 'QT-261024001', 'restarts each day';
  update public.document_sequences set last_number = 999
    where organization_id = current_setting('test.org_a')::uuid and doc_type = 'invoice' and seq_date = date '2026-10-23';
  if not found then
    insert into public.document_sequences (organization_id, doc_type, year, seq_date, last_number)
    values (current_setting('test.org_a')::uuid, 'invoice', 2026, date '2026-10-23', 999);
  end if;
  assert public.next_document_number(current_setting('test.org_a')::uuid, 'invoice', date '2026-10-23') = 'INV-2610231000', 'no wrap after 999';
end $$;

set role authenticated;
select set_config('request.jwt.claim.sub', '22222222-2222-2222-2222-222222222222', false) \g /dev/null
do $$
begin
  assert (select count(*) from public.cash_sales) = 0, 'B cannot see A cash sales';
  assert (select count(*) from public.cash_sale_items) = 0, 'B cannot see A cash sale items';
  begin
    perform public.record_cash_sale(current_setting('test.org_a')::uuid,
      '{"items":[{"description":"x","quantity":1,"unit_price":1}]}'::jsonb, gen_random_uuid());
    raise exception 'B recorded a sale for A';
  exception when insufficient_privilege then null;
  end;
end $$;
reset role;
select 'ALL CASH SALE TESTS PASSED' as result;
