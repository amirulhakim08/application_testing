-- Phase 2 sales tests: money math, quotation -> invoice, immutability, partial payments, idempotency, isolation.
-- Runs after rls_test.sql (users A=1111…, B=2222…, C=3333… and their businesses already exist).
\set ON_ERROR_STOP on
set client_min_messages = warning;

\o /dev/null
select set_config('test.org_a', (select id::text from public.organizations where created_by = '11111111-1111-1111-1111-111111111111'), false);
select set_config('test.org_b', (select id::text from public.organizations where created_by = '22222222-2222-2222-2222-222222222222'), false);
select set_config('test.year', to_char(public.today_kl(), 'YYMMDD'), false);
\o

-- ---------------------------------------------------------------- user A
set role authenticated;
\o /dev/null
select set_config('request.jwt.claim.sub', '11111111-1111-1111-1111-111111111111', false);
\o

insert into public.customers (id, organization_id, name, company_name, phone, billing_address)
values ('c0000000-0000-0000-0000-00000000000a', current_setting('test.org_a')::uuid, 'Encik Ali', 'Syarikat Maju Jaya', '012-3456789', 'Kajang');
insert into public.products_services (id, organization_id, kind, name, unit, default_price, tax_rate)
values ('d0000000-0000-0000-0000-00000000000a', current_setting('test.org_a')::uuid, 'service', 'Website Development', 'project', 2500.00, 8);

-- Quotation with per-line tax, a line discount and a 10% service charge
\o /dev/null
select set_config('test.qt', public.save_quotation(current_setting('test.org_a')::uuid, null, jsonb_build_object(
  'customer_id', 'c0000000-0000-0000-0000-00000000000a',
  'valid_until', (public.today_kl() + 30)::text,
  'items', jsonb_build_array(
    jsonb_build_object('product_id', 'd0000000-0000-0000-0000-00000000000a', 'description', 'Website Development', 'quantity', 2, 'unit_price', '150.00', 'tax_rate', '8'),
    jsonb_build_object('description', 'Domain setup', 'quantity', 1, 'unit_price', '99.99', 'discount_amount', '9.99')),
  'charges', jsonb_build_array(jsonb_build_object('label', 'Caj perkhidmatan', 'kind', 'percent', 'value', '10'))
))::text, false);
\o
do $$
declare q record;
begin
  select * into q from public.quotations where id = current_setting('test.qt')::uuid;
  assert q.number = 'QT-' || current_setting('test.year') || '001', 'quotation number ' || q.number;
  assert q.subtotal = 399.99, 'subtotal ' || q.subtotal;
  assert q.discount_total = 9.99, 'discount';
  assert q.charges_total = 39.00, 'service charge 10% of 390.00';
  assert q.tax_total = 24.00, 'tax 8% of 300.00';
  assert q.total = 453.00, 'total ' || q.total;
  assert (select count(*) from public.quotation_items where quotation_id = q.id) = 2, 'two items';
  assert (select line_total from public.quotation_items where quotation_id = q.id and position = 1) = 324.00, 'line 1 total';
end $$;

-- Invalid inputs are rejected
do $$ begin
  begin
    perform public.save_quotation(current_setting('test.org_a')::uuid, null, '{"items": []}'::jsonb);
    raise exception 'empty quotation accepted';
  exception when check_violation then null;
  end;
  begin
    perform public.save_quotation(current_setting('test.org_a')::uuid, null,
      '{"items": [{"description": "x", "quantity": 1, "unit_price": "10.00", "discount_amount": "10.01"}]}'::jsonb);
    raise exception 'discount above line amount accepted';
  exception when check_violation then null;
  end;
  begin
    perform public.save_quotation(current_setting('test.org_a')::uuid, null,
      '{"items": [{"description": "x", "quantity": 1, "unit_price": "10.005"}]}'::jsonb);
    raise exception 'fractional sen accepted';
  exception when check_violation then null;
  end;
end $$;

-- Direct writes are not allowed (documents go through the functions only)
do $$ begin
  begin
    insert into public.invoices (organization_id, total) values (current_setting('test.org_a')::uuid, 1);
    raise exception 'direct invoice insert allowed';
  exception when insufficient_privilege then null;
  end;
end $$;

-- Sent quotations cannot be edited
\o /dev/null
select public.set_quotation_status(current_setting('test.qt')::uuid, 'sent');
\o
do $$ begin
  begin
    perform public.save_quotation(current_setting('test.org_a')::uuid, current_setting('test.qt')::uuid,
      '{"items": [{"description": "x", "quantity": 1, "unit_price": "1.00"}]}'::jsonb);
    raise exception 'sent quotation edited';
  exception when check_violation then null;
  end;
end $$;

-- Convert to invoice: linked draft, idempotent, quotation preserved
\o /dev/null
select set_config('test.inv', public.convert_quotation_to_invoice(current_setting('test.qt')::uuid)::text, false);
\o
do $$
declare i record; q record;
begin
  assert public.convert_quotation_to_invoice(current_setting('test.qt')::uuid) = current_setting('test.inv')::uuid, 'second convert returns same invoice';
  assert (select count(*) from public.invoices where quotation_id = current_setting('test.qt')::uuid) = 1, 'only one invoice';
  select * into i from public.invoices where id = current_setting('test.inv')::uuid;
  select * into q from public.quotations where id = current_setting('test.qt')::uuid;
  assert i.status = 'draft' and i.number is null, 'draft invoice without number';
  assert i.total = 453.00 and i.tax_total = 24.00 and i.charges_total = 39.00, 'totals copied';
  assert (select count(*) from public.invoice_items where invoice_id = i.id) = 2, 'items copied';
  assert q.status = 'accepted' and q.total = 453.00 and q.number = 'QT-' || current_setting('test.year') || '001', 'quotation preserved';
end $$;

-- Issue: number + snapshots, then immutable
\o /dev/null
select public.issue_invoice(current_setting('test.inv')::uuid);
\o
do $$
declare i record;
begin
  select * into i from public.invoices where id = current_setting('test.inv')::uuid;
  assert i.status = 'issued' and i.number = 'INV-' || current_setting('test.year') || '001', 'issued number ' || coalesce(i.number, 'null');
  assert i.customer_snapshot ->> 'name' = 'Encik Ali', 'customer snapshot';
  assert i.company_snapshot ->> 'bank_name' = 'Maybank', 'company snapshot with bank';
  assert public.issue_invoice(i.id) = i.number, 'issue is idempotent';
end $$;
reset role;
do $$ begin
  -- even the database owner cannot silently overwrite an issued invoice
  begin
    update public.invoices set total = 1 where id = current_setting('test.inv')::uuid;
    raise exception 'issued invoice total changed';
  exception when check_violation then null;
  end;
  begin
    update public.invoice_items set unit_price = 1 where invoice_id = current_setting('test.inv')::uuid;
    raise exception 'issued invoice item changed';
  exception when check_violation then null;
  end;
end $$;
-- Customer details change later; the issued invoice keeps its snapshot
update public.customers set name = 'Encik Ali bin Abu' where id = 'c0000000-0000-0000-0000-00000000000a';
do $$ begin
  assert (select customer_snapshot ->> 'name' from public.invoices where id = current_setting('test.inv')::uuid) = 'Encik Ali', 'snapshot preserved';
end $$;

set role authenticated;
\o /dev/null
select set_config('request.jwt.claim.sub', '11111111-1111-1111-1111-111111111111', false);
-- Test 4/5: RM5,000 invoice, RM2,000 then RM3,000
select set_config('test.inv5k', public.save_invoice(current_setting('test.org_a')::uuid, null, jsonb_build_object(
  'customer_id', 'c0000000-0000-0000-0000-00000000000a', 'due_date', (public.today_kl() + 14)::text,
  'items', jsonb_build_array(jsonb_build_object('description', 'Projek', 'quantity', 1, 'unit_price', '5000.00')))
)::text, false);
select public.issue_invoice(current_setting('test.inv5k')::uuid);
select set_config('test.key1', gen_random_uuid()::text, false);
select * from public.record_payment(current_setting('test.org_a')::uuid, current_setting('test.inv5k')::uuid, null, 2000.00,
  public.today_kl(), 'bank_transfer', 'MBB123', null, null, current_setting('test.key1')::uuid);
-- Same request again (double click / network retry) -> same payment, no duplicate
select * from public.record_payment(current_setting('test.org_a')::uuid, current_setting('test.inv5k')::uuid, null, 2000.00,
  public.today_kl(), 'bank_transfer', 'MBB123', null, null, current_setting('test.key1')::uuid);
\o
do $$
declare b record;
begin
  select * into b from public.invoice_balances where invoice_id = current_setting('test.inv5k')::uuid;
  assert b.amount_paid = 2000.00 and b.outstanding = 3000.00, 'partial: outstanding ' || b.outstanding;
  assert (select count(*) from public.payments where invoice_id = current_setting('test.inv5k')::uuid) = 1, 'no duplicate payment';
  assert (select count(*) from public.receipts) = 1, 'one receipt';
  -- overpayment rejected
  begin
    perform public.record_payment(current_setting('test.org_a')::uuid, current_setting('test.inv5k')::uuid, null, 3000.01,
      public.today_kl(), 'cash', null, null, null, gen_random_uuid());
    raise exception 'overpayment accepted';
  exception when check_violation then null;
  end;
  -- payments on draft invoices rejected
  begin
    perform public.record_payment(current_setting('test.org_a')::uuid,
      public.save_invoice(current_setting('test.org_a')::uuid, null, '{"items": [{"description": "x", "quantity": 1, "unit_price": "5.00"}]}'::jsonb),
      null, 1, public.today_kl(), 'cash', null, null, null, gen_random_uuid());
    raise exception 'payment on draft accepted';
  exception when check_violation then null;
  end;
end $$;
\o /dev/null
select * from public.record_payment(current_setting('test.org_a')::uuid, current_setting('test.inv5k')::uuid, null, 3000.00,
  public.today_kl(), 'duitnow', null, null, null, gen_random_uuid());
\o
do $$
declare b record;
begin
  select * into b from public.invoice_balances where invoice_id = current_setting('test.inv5k')::uuid;
  assert b.outstanding = 0.00 and b.amount_paid = 5000.00, 'fully paid';
  assert (select count(distinct number) from public.receipts) = 2, 'separate receipt per payment';
  assert (select min(number) from public.receipts) = 'RC-' || current_setting('test.year') || '001', 'receipt numbering';
  -- invoices with valid payments cannot be voided
  begin
    perform public.void_invoice(current_setting('test.inv5k')::uuid, 'mistake');
    raise exception 'voided invoice with payments';
  exception when check_violation then null;
  end;
end $$;

-- Void the RM3,000 payment: balance goes back up, receipt voided but kept
\o /dev/null
select public.void_payment((select id from public.payments where amount = 3000.00), 'Cek tendang');
\o
do $$ begin
  assert (select outstanding from public.invoice_balances where invoice_id = current_setting('test.inv5k')::uuid) = 3000.00, 'void restores balance';
  assert (select count(*) from public.receipts where voided_at is not null) = 1, 'receipt voided, not deleted';
end $$;

-- Standalone payment (walk-in sale) still gets a receipt
\o /dev/null
select * from public.record_payment(current_setting('test.org_a')::uuid, null, null, 45.00, public.today_kl(), 'cash', null,
  'Jualan kaunter', null, gen_random_uuid());
\o
do $$ begin
  assert (select count(*) from public.receipts r join public.payments p on p.id = r.payment_id where p.invoice_id is null) = 1, 'standalone receipt';
end $$;

-- Duplicate creates a fresh draft
do $$ declare v uuid; begin
  v := public.duplicate_invoice(current_setting('test.inv')::uuid);
  assert (select status from public.invoices where id = v) = 'draft', 'duplicate is draft';
  assert (select total from public.invoices where id = v) = 453.00, 'duplicate total';
  v := public.duplicate_quotation(current_setting('test.qt')::uuid);
  assert (select number from public.quotations where id = v) = 'QT-' || current_setting('test.year') || '002', 'duplicate quotation number';
end $$;

-- ---------------------------------------------------------------- staff C of business A can work with documents
\o /dev/null
select set_config('request.jwt.claim.sub', '33333333-3333-3333-3333-333333333333', false);
\o
do $$ begin
  assert (select count(*) from public.invoices) >= 3, 'staff sees business invoices';
end $$;

-- ---------------------------------------------------------------- user B (other business): sees and changes nothing
\o /dev/null
select set_config('request.jwt.claim.sub', '22222222-2222-2222-2222-222222222222', false);
\o
do $$ begin
  assert (select count(*) from public.customers) = 0, 'B cannot see A customers';
  assert (select count(*) from public.products_services) = 0, 'B cannot see A products';
  assert (select count(*) from public.quotations) = 0, 'B cannot see A quotations';
  assert (select count(*) from public.invoices) = 0, 'B cannot see A invoices';
  assert (select count(*) from public.invoice_items) = 0, 'B cannot see A invoice items';
  assert (select count(*) from public.payments) = 0, 'B cannot see A payments';
  assert (select count(*) from public.receipts) = 0, 'B cannot see A receipts';
  assert (select count(*) from public.invoice_balances) = 0, 'B cannot see A balances';
  begin
    perform public.save_invoice(current_setting('test.org_a')::uuid, null, '{"items": [{"description": "x", "quantity": 1, "unit_price": "1.00"}]}'::jsonb);
    raise exception 'B wrote invoice into A';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.issue_invoice(current_setting('test.inv5k')::uuid);
    raise exception 'B issued A invoice';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.record_payment(current_setting('test.org_a')::uuid, current_setting('test.inv5k')::uuid, null, 1,
      public.today_kl(), 'cash', null, null, null, gen_random_uuid());
    raise exception 'B paid A invoice';
  exception when insufficient_privilege then null;
  end;
  begin
    perform * from public.record_payment(current_setting('test.org_b')::uuid, current_setting('test.inv5k')::uuid, null, 1,
      public.today_kl(), 'cash', null, null, null, gen_random_uuid());
    raise exception 'B paid A invoice through own org';
  exception when no_data_found then null;
  end;
  begin
    perform public.void_payment((select id from public.payments limit 1), 'x');
    -- B cannot even see the payment id, so the select returns null -> not found
    raise exception 'B voided A payment';
  exception when no_data_found then null;
  end;
  begin
    perform public.convert_quotation_to_invoice(current_setting('test.qt')::uuid);
    raise exception 'B converted A quotation';
  exception when insufficient_privilege then null;
  end;
  begin
    insert into public.customers (organization_id, name) values (current_setting('test.org_a')::uuid, 'Hack');
    raise exception 'B inserted A customer';
  exception when insufficient_privilege then null;
  end;
end $$;
-- B's own numbering starts at 0001 (per business)
\o /dev/null
select set_config('test.inv_b', public.save_invoice(current_setting('test.org_b')::uuid, null,
  '{"items": [{"description": "Nasi", "quantity": 1, "unit_price": "12.00"}]}'::jsonb)::text, false);
\o
do $$ begin
  begin
    perform public.issue_invoice(current_setting('test.inv_b')::uuid);
    raise exception 'issued without customer';
  exception when check_violation then null;
  end;
end $$;
reset role;
do $$ begin
  assert (select count(*) from public.invoices where organization_id = current_setting('test.org_a')::uuid and status = 'issued') = 2, 'A invoices intact';
end $$;

select 'ALL SALES TESTS PASSED' as result;
