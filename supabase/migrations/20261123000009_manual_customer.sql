-- BukuTigaLima: customer details typed by hand on a document (not saved to the customer list).
-- When customer_id is null, payload.customer_manual {name, company_name, phone, email, billing_address} is stored as the
-- document's customer_snapshot, so it prints, converts, duplicates and issues like a listed customer. Picking a listed
-- customer clears it (drafts then show the customer's live details until issued).

create or replace function public.manual_party(p jsonb) returns jsonb
language plpgsql immutable set search_path = public as $$
declare v_name text := left(trim(coalesce(p ->> 'name', '')), 160);
begin
  if p is null or jsonb_typeof(p) <> 'object' or v_name = '' then return null; end if;
  return jsonb_build_object(
    'name', v_name,
    'company_name', nullif(left(trim(coalesce(p ->> 'company_name', '')), 160), ''),
    'phone', nullif(left(trim(coalesce(p ->> 'phone', '')), 40), ''),
    'email', nullif(left(trim(coalesce(p ->> 'email', '')), 160), ''),
    'billing_address', nullif(left(trim(coalesce(p ->> 'billing_address', '')), 500), ''),
    'manual', true);
end $$;
revoke all on function public.manual_party(jsonb) from public, anon;
grant execute on function public.manual_party(jsonb) to authenticated;


create or replace function public.save_quotation(p_org uuid, p_id uuid, p_payload jsonb) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_id uuid := p_id;
  v_issue date := coalesce(nullif(p_payload ->> 'issue_date', '')::date, public.today_kl());
  v_valid date := nullif(p_payload ->> 'valid_until', '')::date;
  v_customer uuid := nullif(p_payload ->> 'customer_id', '')::uuid;
  v_sub numeric; v_disc numeric; v_tax numeric; v_charges jsonb; v_charges_total numeric;
  v_status public.quotation_status;
  v_manual jsonb := case when nullif(p_payload ->> 'customer_id', '') is null then public.manual_party(p_payload -> 'customer_manual') end;
begin
  perform public.require_member(p_org);
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

  if v_id is null then
    insert into public.quotations (organization_id, number, customer_id, customer_snapshot, issue_date, valid_until, title, notes, terms,
      charges, subtotal, discount_total, charges_total, tax_total, total, created_by)
    values (p_org, public.next_document_number(p_org, 'quotation', v_issue), v_customer, v_manual, v_issue, v_valid,
      nullif(trim(p_payload ->> 'title'), ''), nullif(trim(p_payload ->> 'notes'), ''), nullif(trim(p_payload ->> 'terms'), ''),
      v_charges, v_sub, v_disc, v_charges_total, v_tax, v_sub - v_disc + v_charges_total + v_tax, auth.uid())
    returning id into v_id;
  else
    select status into v_status from public.quotations where id = v_id and organization_id = p_org for update;
    if not found then raise exception 'quotation not found' using errcode = 'no_data_found'; end if;
    if v_status <> 'draft' then raise exception 'only draft quotations can be edited' using errcode = 'check_violation'; end if;
    update public.quotations set customer_id = v_customer, customer_snapshot = v_manual, issue_date = v_issue, valid_until = v_valid,
      title = nullif(trim(p_payload ->> 'title'), ''), notes = nullif(trim(p_payload ->> 'notes'), ''),
      terms = nullif(trim(p_payload ->> 'terms'), ''), charges = v_charges, subtotal = v_sub, discount_total = v_disc,
      charges_total = v_charges_total, tax_total = v_tax, total = v_sub - v_disc + v_charges_total + v_tax
    where id = v_id;
    delete from public.quotation_items where quotation_id = v_id;
  end if;

  insert into public.quotation_items (quotation_id, organization_id, position, product_id, description, quantity, unit,
    unit_price, discount_amount, tax_rate, line_subtotal, tax_amount, line_total)
  select v_id, p_org, t.pos, t.product_id, t.description, t.quantity, t.unit, t.unit_price, t.discount_amount,
    t.tax_rate, t.line_subtotal, t.tax_amount, t.line_total from _items t;
  drop table _items;

  insert into public.audit_logs (user_id, organization_id, action, entity, entity_id)
  values (auth.uid(), p_org, case when p_id is null then 'quotation.create' else 'quotation.update' end, 'quotation', v_id);
  return v_id;
end $$;

create or replace function public.set_quotation_status(p_id uuid, p_status public.quotation_status) returns void
language plpgsql security definer set search_path = public as $$
declare q record;
begin
  select * into q from public.quotations where id = p_id for update;
  if not found then raise exception 'quotation not found' using errcode = 'no_data_found'; end if;
  perform public.require_member(q.organization_id);
  if q.converted_invoice_id is not null and p_status <> 'accepted' then
    raise exception 'quotation already converted to an invoice' using errcode = 'check_violation';
  end if;
  if p_status = 'draft' then raise exception 'cannot return to draft; duplicate instead' using errcode = 'check_violation'; end if;
  if p_status = 'sent' and q.status <> 'draft' and q.status <> 'sent' then
    raise exception 'invalid status change' using errcode = 'check_violation';
  end if;
  if q.customer_id is null and q.customer_snapshot is null then raise exception 'choose a customer first' using errcode = 'check_violation'; end if;
  update public.quotations set status = p_status,
    customer_snapshot = coalesce(customer_snapshot, public.customer_snapshot(customer_id)),
    sent_at = case when p_status = 'sent' then coalesce(sent_at, now()) else sent_at end,
    decided_at = case when p_status in ('accepted', 'rejected') then now() else decided_at end
  where id = p_id;
  insert into public.audit_logs (user_id, organization_id, action, entity, entity_id, metadata)
  values (auth.uid(), q.organization_id, 'quotation.status', 'quotation', p_id, jsonb_build_object('status', p_status));
end $$;

create or replace function public.convert_quotation_to_invoice(p_id uuid) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  q record;
  v_inv uuid;
  v_terms int;
begin
  select * into q from public.quotations where id = p_id for update;
  if not found then raise exception 'quotation not found' using errcode = 'no_data_found'; end if;
  perform public.require_member(q.organization_id);
  if q.converted_invoice_id is not null then return q.converted_invoice_id; end if;
  if q.status = 'rejected' then raise exception 'rejected quotations cannot be converted' using errcode = 'check_violation'; end if;
  if q.customer_id is null and q.customer_snapshot is null then raise exception 'choose a customer first' using errcode = 'check_violation'; end if;
  select payment_terms_days into v_terms from public.organization_settings where organization_id = q.organization_id;

  insert into public.invoices (organization_id, customer_id, customer_snapshot, invoice_date, due_date, quotation_id, notes, terms, charges,
    subtotal, discount_total, charges_total, tax_total, total, created_by)
  values (q.organization_id, q.customer_id, case when q.customer_id is null then q.customer_snapshot end, public.today_kl(), public.today_kl() + coalesce(v_terms, 30), q.id, q.notes, q.terms,
    q.charges, q.subtotal, q.discount_total, q.charges_total, q.tax_total, q.total, auth.uid())
  returning id into v_inv;
  insert into public.invoice_items (invoice_id, organization_id, position, product_id, description, quantity, unit,
    unit_price, discount_amount, tax_rate, line_subtotal, tax_amount, line_total)
  select v_inv, organization_id, position, product_id, description, quantity, unit, unit_price, discount_amount, tax_rate,
    line_subtotal, tax_amount, line_total
  from public.quotation_items where quotation_id = q.id order by position;

  update public.quotations set converted_invoice_id = v_inv, status = 'accepted',
    decided_at = coalesce(decided_at, now()),
    customer_snapshot = coalesce(customer_snapshot, public.customer_snapshot(customer_id))
  where id = q.id;
  insert into public.audit_logs (user_id, organization_id, action, entity, entity_id, metadata)
  values (auth.uid(), q.organization_id, 'quotation.convert', 'quotation', q.id, jsonb_build_object('invoice_id', v_inv));
  return v_inv;
end $$;

create or replace function public.duplicate_quotation(p_id uuid) returns uuid
language plpgsql security definer set search_path = public as $$
declare q record; v_new uuid; v_validity int;
begin
  select * into q from public.quotations where id = p_id;
  if not found then raise exception 'quotation not found' using errcode = 'no_data_found'; end if;
  perform public.require_member(q.organization_id);
  select quotation_validity_days into v_validity from public.organization_settings where organization_id = q.organization_id;
  insert into public.quotations (organization_id, number, customer_id, customer_snapshot, issue_date, valid_until, title, notes, terms, charges,
    subtotal, discount_total, charges_total, tax_total, total, created_by)
  values (q.organization_id, public.next_document_number(q.organization_id, 'quotation', public.today_kl()), q.customer_id,
    case when q.customer_id is null then q.customer_snapshot end,
    public.today_kl(), public.today_kl() + coalesce(v_validity, 30), q.title, q.notes, q.terms, q.charges, q.subtotal,
    q.discount_total, q.charges_total, q.tax_total, q.total, auth.uid())
  returning id into v_new;
  insert into public.quotation_items (quotation_id, organization_id, position, product_id, description, quantity, unit,
    unit_price, discount_amount, tax_rate, line_subtotal, tax_amount, line_total)
  select v_new, organization_id, position, product_id, description, quantity, unit, unit_price, discount_amount, tax_rate,
    line_subtotal, tax_amount, line_total from public.quotation_items where quotation_id = p_id;
  insert into public.audit_logs (user_id, organization_id, action, entity, entity_id, metadata)
  values (auth.uid(), q.organization_id, 'quotation.duplicate', 'quotation', v_new, jsonb_build_object('from', p_id));
  return v_new;
end $$;

create or replace function public.save_invoice(p_org uuid, p_id uuid, p_payload jsonb) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_id uuid := p_id;
  v_date date := coalesce(nullif(p_payload ->> 'invoice_date', '')::date, public.today_kl());
  v_due date := nullif(p_payload ->> 'due_date', '')::date;
  v_customer uuid := nullif(p_payload ->> 'customer_id', '')::uuid;
  v_sub numeric; v_disc numeric; v_tax numeric; v_charges jsonb; v_charges_total numeric;
  v_status public.invoice_status;
  v_manual jsonb := case when nullif(p_payload ->> 'customer_id', '') is null then public.manual_party(p_payload -> 'customer_manual') end;
begin
  perform public.require_member(p_org);
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

  if v_id is null then
    insert into public.invoices (organization_id, customer_id, customer_snapshot, invoice_date, due_date, customer_po, payment_terms, notes, terms,
      charges, subtotal, discount_total, charges_total, tax_total, total, created_by)
    values (p_org, v_customer, v_manual, v_date, v_due, nullif(trim(p_payload ->> 'customer_po'), ''),
      nullif(trim(p_payload ->> 'payment_terms'), ''), nullif(trim(p_payload ->> 'notes'), ''), nullif(trim(p_payload ->> 'terms'), ''),
      v_charges, v_sub, v_disc, v_charges_total, v_tax, v_sub - v_disc + v_charges_total + v_tax, auth.uid())
    returning id into v_id;
  else
    select status into v_status from public.invoices where id = v_id and organization_id = p_org for update;
    if not found then raise exception 'invoice not found' using errcode = 'no_data_found'; end if;
    if v_status <> 'draft' then raise exception 'issued invoices cannot be edited' using errcode = 'check_violation'; end if;
    update public.invoices set customer_id = v_customer, customer_snapshot = v_manual, invoice_date = v_date, due_date = v_due,
      customer_po = nullif(trim(p_payload ->> 'customer_po'), ''), payment_terms = nullif(trim(p_payload ->> 'payment_terms'), ''),
      notes = nullif(trim(p_payload ->> 'notes'), ''), terms = nullif(trim(p_payload ->> 'terms'), ''), charges = v_charges,
      subtotal = v_sub, discount_total = v_disc, charges_total = v_charges_total, tax_total = v_tax,
      total = v_sub - v_disc + v_charges_total + v_tax
    where id = v_id;
    delete from public.invoice_items where invoice_id = v_id;
  end if;

  insert into public.invoice_items (invoice_id, organization_id, position, product_id, description, quantity, unit,
    unit_price, discount_amount, tax_rate, line_subtotal, tax_amount, line_total)
  select v_id, p_org, t.pos, t.product_id, t.description, t.quantity, t.unit, t.unit_price, t.discount_amount,
    t.tax_rate, t.line_subtotal, t.tax_amount, t.line_total from _items t;
  drop table _items;

  insert into public.audit_logs (user_id, organization_id, action, entity, entity_id)
  values (auth.uid(), p_org, case when p_id is null then 'invoice.create' else 'invoice.update' end, 'invoice', v_id);
  return v_id;
end $$;

create or replace function public.issue_invoice(p_id uuid) returns text
language plpgsql security definer set search_path = public as $$
declare inv record; v_number text; v_company jsonb;
begin
  select * into inv from public.invoices where id = p_id for update;
  if not found then raise exception 'invoice not found' using errcode = 'no_data_found'; end if;
  perform public.require_member(inv.organization_id);
  if inv.status <> 'draft' then return inv.number; end if;  -- idempotent
  if inv.customer_id is null and inv.customer_snapshot is null then raise exception 'choose a customer first' using errcode = 'check_violation'; end if;
  if inv.total <= 0 then raise exception 'invoice total must be more than zero' using errcode = 'check_violation'; end if;
  if not exists (select 1 from public.invoice_items where invoice_id = p_id) then
    raise exception 'at least one item is required' using errcode = 'check_violation';
  end if;
  select jsonb_build_object('name', o.name, 'registration_no', o.registration_no, 'address', o.address, 'email', o.email,
      'phone', o.phone, 'website', o.website, 'logo_path', o.logo_path, 'bank_name', o.bank_name,
      'bank_account_no', o.bank_account_no, 'bank_account_holder', o.bank_account_holder,
      'tax_label', s.tax_label, 'tax_registration_no', s.tax_registration_no)
    into v_company
  from public.organizations o join public.organization_settings s on s.organization_id = o.id
  where o.id = inv.organization_id;
  v_number := public.next_document_number(inv.organization_id, 'invoice', inv.invoice_date);
  update public.invoices set status = 'issued', number = v_number, issued_at = now(),
    customer_snapshot = coalesce(public.customer_snapshot(inv.customer_id), inv.customer_snapshot), company_snapshot = v_company
  where id = p_id;
  insert into public.audit_logs (user_id, organization_id, action, entity, entity_id, metadata)
  values (auth.uid(), inv.organization_id, 'invoice.issue', 'invoice', p_id, jsonb_build_object('number', v_number));
  return v_number;
end $$;

create or replace function public.duplicate_invoice(p_id uuid) returns uuid
language plpgsql security definer set search_path = public as $$
declare inv record; v_new uuid; v_terms int;
begin
  select * into inv from public.invoices where id = p_id;
  if not found then raise exception 'invoice not found' using errcode = 'no_data_found'; end if;
  perform public.require_member(inv.organization_id);
  select payment_terms_days into v_terms from public.organization_settings where organization_id = inv.organization_id;
  insert into public.invoices (organization_id, customer_id, customer_snapshot, invoice_date, due_date, customer_po, payment_terms, notes, terms,
    charges, subtotal, discount_total, charges_total, tax_total, total, created_by)
  values (inv.organization_id, inv.customer_id, case when inv.customer_id is null then inv.customer_snapshot end, public.today_kl(), public.today_kl() + coalesce(v_terms, 30), null,
    inv.payment_terms, inv.notes, inv.terms, inv.charges, inv.subtotal, inv.discount_total, inv.charges_total, inv.tax_total,
    inv.total, auth.uid())
  returning id into v_new;
  insert into public.invoice_items (invoice_id, organization_id, position, product_id, description, quantity, unit,
    unit_price, discount_amount, tax_rate, line_subtotal, tax_amount, line_total)
  select v_new, organization_id, position, product_id, description, quantity, unit, unit_price, discount_amount, tax_rate,
    line_subtotal, tax_amount, line_total from public.invoice_items where invoice_id = p_id;
  insert into public.audit_logs (user_id, organization_id, action, entity, entity_id, metadata)
  values (auth.uid(), inv.organization_id, 'invoice.duplicate', 'invoice', v_new, jsonb_build_object('from', p_id));
  return v_new;
end $$;

create or replace function public.create_delivery_order_from(p_source text, p_id uuid) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_org uuid; v_customer uuid; v_do uuid; v_addr text; v_snap jsonb;
begin
  if p_source = 'invoice' then
    select organization_id, customer_id, customer_snapshot into v_org, v_customer, v_snap from public.invoices where id = p_id;
  elsif p_source = 'quotation' then
    select organization_id, customer_id, customer_snapshot into v_org, v_customer, v_snap from public.quotations where id = p_id;
  else
    raise exception 'invalid source' using errcode = 'check_violation';
  end if;
  if v_org is null then raise exception 'document not found' using errcode = 'no_data_found'; end if;
  perform public.require_member(v_org);
  select coalesce(delivery_address, billing_address) into v_addr from public.customers where id = v_customer;
  if v_customer is null then v_addr := v_snap ->> 'billing_address'; end if;

  insert into public.delivery_orders (organization_id, customer_id, customer_snapshot, delivery_address, quotation_id, invoice_id, created_by)
  values (v_org, v_customer, case when v_customer is null then v_snap end, v_addr, case when p_source = 'quotation' then p_id end,
    case when p_source = 'invoice' then p_id end, auth.uid())
  returning id into v_do;

  if p_source = 'invoice' then
    insert into public.delivery_order_items (delivery_order_id, organization_id, position, description, quantity, unit)
    select v_do, organization_id, position, description, quantity, unit from public.invoice_items where invoice_id = p_id;
  else
    insert into public.delivery_order_items (delivery_order_id, organization_id, position, description, quantity, unit)
    select v_do, organization_id, position, description, quantity, unit from public.quotation_items where quotation_id = p_id;
  end if;
  insert into public.audit_logs (user_id, organization_id, action, entity, entity_id, metadata)
  values (auth.uid(), v_org, 'delivery_order.create_from', 'delivery_order', v_do, jsonb_build_object('source', p_source, 'id', p_id));
  return v_do;
end $$;

create or replace function public.issue_delivery_order(p_id uuid) returns text
language plpgsql security definer set search_path = public as $$
declare d record; v_number text;
begin
  select * into d from public.delivery_orders where id = p_id for update;
  if not found then raise exception 'delivery order not found' using errcode = 'no_data_found'; end if;
  perform public.require_member(d.organization_id);
  if d.status <> 'draft' then return d.number; end if;
  if d.customer_id is null and d.customer_snapshot is null then raise exception 'choose a customer first' using errcode = 'check_violation'; end if;
  if not exists (select 1 from public.delivery_order_items where delivery_order_id = p_id) then
    raise exception 'at least one item is required' using errcode = 'check_violation';
  end if;
  v_number := public.next_document_number(d.organization_id, 'delivery_order', d.issue_date);
  update public.delivery_orders set status = 'issued', number = v_number, issued_at = now(),
    customer_snapshot = coalesce(public.customer_snapshot(d.customer_id), d.customer_snapshot)
  where id = p_id;
  insert into public.audit_logs (user_id, organization_id, action, entity, entity_id, metadata)
  values (auth.uid(), d.organization_id, 'delivery_order.issue', 'delivery_order', p_id, jsonb_build_object('number', v_number));
  return v_number;
end $$;

create or replace function public.save_delivery_order(p_org uuid, p_id uuid, p_payload jsonb) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_id uuid := p_id;
  v_customer uuid := nullif(p_payload ->> 'customer_id', '')::uuid;
  v_status public.delivery_status;
  it jsonb;
  i int := 0;
  v_qty numeric;
begin
  perform public.require_member(p_org);
  if v_customer is not null and not exists (select 1 from public.customers where id = v_customer and organization_id = p_org) then
    raise exception 'customer not found' using errcode = 'foreign_key_violation';
  end if;
  if jsonb_typeof(p_payload -> 'items') <> 'array' or jsonb_array_length(p_payload -> 'items') = 0 then
    raise exception 'at least one item is required' using errcode = 'check_violation';
  end if;
  if jsonb_array_length(p_payload -> 'items') > 200 then raise exception 'too many items' using errcode = 'check_violation'; end if;

  if v_id is null then
    insert into public.delivery_orders (organization_id, customer_id, issue_date, delivery_address, notes, created_by)
    values (p_org, v_customer, coalesce(nullif(p_payload ->> 'issue_date', '')::date, public.today_kl()),
      nullif(trim(p_payload ->> 'delivery_address'), ''), nullif(trim(p_payload ->> 'notes'), ''), auth.uid())
    returning id into v_id;
  else
    select status into v_status from public.delivery_orders where id = v_id and organization_id = p_org for update;
    if not found then raise exception 'delivery order not found' using errcode = 'no_data_found'; end if;
    if v_status <> 'draft' then raise exception 'only draft delivery orders can be edited' using errcode = 'check_violation'; end if;
    update public.delivery_orders set customer_id = v_customer,
      customer_snapshot = case when v_customer is null then customer_snapshot end,
      issue_date = coalesce(nullif(p_payload ->> 'issue_date', '')::date, issue_date),
      delivery_address = nullif(trim(p_payload ->> 'delivery_address'), ''), notes = nullif(trim(p_payload ->> 'notes'), '')
    where id = v_id;
    delete from public.delivery_order_items where delivery_order_id = v_id;
  end if;

  for it in select * from jsonb_array_elements(p_payload -> 'items') loop
    i := i + 1;
    v_qty := (it ->> 'quantity')::numeric;
    if v_qty is null or v_qty <= 0 or v_qty <> round(v_qty, 3) then raise exception 'invalid quantity on line %', i using errcode = 'check_violation'; end if;
    if char_length(trim(coalesce(it ->> 'description', ''))) = 0 then raise exception 'description required on line %', i using errcode = 'check_violation'; end if;
    insert into public.delivery_order_items (delivery_order_id, organization_id, position, description, quantity, unit)
    values (v_id, p_org, i, trim(it ->> 'description'), v_qty, nullif(trim(coalesce(it ->> 'unit', '')), ''));
  end loop;

  insert into public.audit_logs (user_id, organization_id, action, entity, entity_id)
  values (auth.uid(), p_org, case when p_id is null then 'delivery_order.create' else 'delivery_order.update' end, 'delivery_order', v_id);
  return v_id;
end $$;

create or replace function public.record_cash_sale(p_org uuid, p_payload jsonb, p_key uuid)
returns table (sale_id uuid, payment_id uuid, receipt_number text)
language plpgsql security definer set search_path = public as $$
#variable_conflict use_column
declare
  v_customer uuid := nullif(p_payload ->> 'customer_id', '')::uuid;
  v_date date := coalesce(nullif(p_payload ->> 'sale_date', '')::date, public.today_kl());
  v_sub numeric; v_disc numeric; v_tax numeric; v_charges jsonb; v_charges_total numeric; v_total numeric;
  v_desc text; v_pay uuid; v_no text; v_sale uuid; v_company jsonb;
begin
  perform public.require_member(p_org);
  if p_key is null then raise exception 'missing request key' using errcode = 'check_violation'; end if;

  select s.id, p.id, r.number into v_sale, v_pay, v_no
  from public.payments p join public.cash_sales s on s.payment_id = p.id left join public.receipts r on r.payment_id = p.id
  where p.organization_id = p_org and p.idempotency_key = p_key;
  if found then sale_id := v_sale; payment_id := v_pay; receipt_number := v_no; return next; return; end if;

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
  values (auth.uid(), p_org, 'cash_sale.record', 'cash_sale', v_sale, jsonb_build_object('receipt', v_no, 'total', v_total));
  sale_id := v_sale; payment_id := v_pay; receipt_number := v_no;
  return next;
end $$;
