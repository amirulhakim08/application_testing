-- BukuTigaLima: fixing receipts.
-- (1) "Correct receipt": record_cash_sale accepts payload.replaces_payment_id; the old direct sale receipt is voided
--     (number kept, marked void) in the same transaction that issues the corrected one.
-- (2) "Delete receipt": owners/admins may permanently delete a receipt and its payment within 24 hours of recording
--     it (e.g. pressed by mistake). The receipt number is not reused; the deletion is kept in the audit log.

create or replace function public.record_cash_sale(p_org uuid, p_payload jsonb, p_key uuid)
returns table (sale_id uuid, payment_id uuid, receipt_number text)
language plpgsql security definer set search_path = public as $$
#variable_conflict use_column
declare
  v_customer uuid := nullif(p_payload ->> 'customer_id', '')::uuid;
  v_date date := coalesce(nullif(p_payload ->> 'sale_date', '')::date, public.today_kl());
  v_sub numeric; v_disc numeric; v_tax numeric; v_charges jsonb; v_charges_total numeric; v_total numeric;
  v_desc text; v_pay uuid; v_no text; v_sale uuid; v_company jsonb;
  v_replaces uuid := nullif(p_payload ->> 'replaces_payment_id', '')::uuid;
begin
  perform public.require_member(p_org);
  if p_key is null then raise exception 'missing request key' using errcode = 'check_violation'; end if;

  select s.id, p.id, r.number into v_sale, v_pay, v_no
  from public.payments p join public.cash_sales s on s.payment_id = p.id left join public.receipts r on r.payment_id = p.id
  where p.organization_id = p_org and p.idempotency_key = p_key;
  if found then sale_id := v_sale; payment_id := v_pay; receipt_number := v_no; return next; return; end if;

  -- "Correct receipt": the old direct sale receipt must belong to this business and still be valid.
  if v_replaces is not null and not exists (
    select 1 from public.payments p join public.cash_sales s on s.payment_id = p.id
    where p.id = v_replaces and p.organization_id = p_org and p.voided_at is null) then
    raise exception 'receipt to correct not found or already void' using errcode = 'check_violation';
  end if;
  if v_customer is not null and not exists (select 1 from public.customers where id = v_customer and organization_id = p_org) then
    raise exception 'customer not found' using errcode = 'foreign_key_violation';
  end if;
  create temp table _items on commit drop as select * from public.price_items(p_payload -> 'items');
  if exists (select 1 from _items t where t.product_id is not null
             and not exists (select 1 from public.products_services p where p.id = t.product_id and p.organization_id = p_org)) then
    raise exception 'product not found' using errcode = 'foreign_key_violation';
  end if;
  select coalesce(sum(line_gross), 0), coalesce(sum(t.discount_amount), 0), coalesce(sum(t.tax_amount), 0)
    into v_sub, v_disc, v_tax from _items t;
  v_charges := public.price_charges(p_payload -> 'charges', v_sub - v_disc);
  select coalesce(sum((c ->> 'amount')::numeric), 0) into v_charges_total from jsonb_array_elements(v_charges) c;
  v_total := v_sub - v_disc + v_charges_total + v_tax;
  if v_total <= 0 then raise exception 'total must be more than zero' using errcode = 'check_violation'; end if;
  select left(string_agg(split_part(t.description, E'\n', 1), ', ' order by t.pos), 240) into v_desc from _items t;

  select r.payment_id, r.receipt_number into v_pay, v_no
  from public.record_payment(p_org, null, v_customer, v_total, v_date,
    coalesce(nullif(p_payload ->> 'method', ''), 'cash')::public.collection_method,
    p_payload ->> 'reference', v_desc, p_payload ->> 'notes', p_key) r;

  select jsonb_build_object('name', o.name, 'registration_no', o.registration_no, 'address', o.address, 'email', o.email,
      'phone', o.phone, 'website', o.website, 'logo_path', o.logo_path)
    into v_company from public.organizations o where o.id = p_org;

  insert into public.cash_sales (organization_id, payment_id, customer_id, customer_snapshot, sale_date, notes, charges,
    subtotal, discount_total, charges_total, tax_total, total, company_snapshot, created_by)
  values (p_org, v_pay, v_customer, case when v_customer is not null then public.customer_snapshot(v_customer) else public.manual_party(p_payload -> 'customer_manual') end, v_date,
    nullif(trim(p_payload ->> 'notes'), ''), v_charges, v_sub, v_disc, v_charges_total, v_tax, v_total, v_company, auth.uid())
  returning id into v_sale;

  insert into public.cash_sale_items (cash_sale_id, organization_id, position, product_id, description, quantity, unit,
    unit_price, discount_amount, tax_rate, line_subtotal, tax_amount, line_total)
  select v_sale, p_org, t.pos, t.product_id, t.description, t.quantity, t.unit, t.unit_price, t.discount_amount,
    t.tax_rate, t.line_subtotal, t.tax_amount, t.line_total from _items t;
  drop table _items;

  insert into public.audit_logs (user_id, organization_id, action, entity, entity_id, metadata)
  values (auth.uid(), p_org, 'cash_sale.record', 'cash_sale', v_sale,
          jsonb_build_object('receipt', v_no, 'total', v_total, 'replaces_payment_id', v_replaces));
  if v_replaces is not null then
    perform public.void_payment(v_replaces, 'Dibetulkan / Corrected: ' || v_no);
  end if;
  sale_id := v_sale; payment_id := v_pay; receipt_number := v_no;
  return next;
end $$;

create or replace function public.delete_payment_receipt(p_payment_id uuid) returns text
language plpgsql security definer set search_path = public as $$
declare pay record; v_no text; v_sale uuid;
begin
  select * into pay from public.payments where id = p_payment_id for update;
  if not found then raise exception 'payment not found' using errcode = 'no_data_found'; end if;
  perform public.require_member(pay.organization_id);
  if not public.has_org_role(pay.organization_id, array['owner', 'admin']::public.org_role[]) then
    raise exception 'only the owner or an admin can delete receipts' using errcode = 'insufficient_privilege';
  end if;
  if pay.created_at < now() - interval '24 hours' then
    raise exception 'receipts can only be deleted within 24 hours; void it instead' using errcode = 'check_violation';
  end if;
  if pay.invoice_id is not null then perform 1 from public.invoices where id = pay.invoice_id for update; end if;
  select number into v_no from public.receipts where payment_id = pay.id;
  select id into v_sale from public.cash_sales where payment_id = pay.id;
  delete from public.cash_sales where payment_id = pay.id;  -- items cascade
  delete from public.receipts where payment_id = pay.id;
  delete from public.payments where id = pay.id;
  insert into public.audit_logs (user_id, organization_id, action, entity, entity_id, metadata)
  values (auth.uid(), pay.organization_id, 'payment.delete', 'payment', pay.id,
          jsonb_build_object('receipt', v_no, 'amount', pay.amount, 'date', pay.payment_date, 'invoice_id', pay.invoice_id,
                             'cash_sale_id', v_sale, 'description', pay.description, 'proof_path', pay.proof_path));
  return pay.proof_path;  -- the caller removes the proof file (if any) from storage
end $$;
revoke all on function public.delete_payment_receipt(uuid) from public, anon;
grant execute on function public.delete_payment_receipt(uuid) to authenticated;
