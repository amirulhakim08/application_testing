-- BukuTigaLima Phase 3: delivery orders (optional; freelancers can invoice without them).
-- Lifecycle: draft (no number) -> issued (DO-2026-0001, customer snapshot) -> delivered (date + receiver), or cancelled.
-- Written only through the SECURITY DEFINER functions below; read access for business members.

create type public.delivery_status as enum ('draft', 'issued', 'delivered', 'cancelled');

create table public.delivery_orders (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  number text,
  status public.delivery_status not null default 'draft',
  customer_id uuid,
  customer_snapshot jsonb,
  issue_date date not null default public.today_kl(),
  delivery_address text check (char_length(delivery_address) <= 500),
  quotation_id uuid,
  invoice_id uuid,
  notes text check (char_length(notes) <= 2000),
  delivered_at date,
  received_by text check (char_length(received_by) <= 120),
  delivery_notes text check (char_length(delivery_notes) <= 1000),
  cancelled_at timestamptz,
  cancel_reason text check (char_length(cancel_reason) <= 300),
  issued_at timestamptz,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, organization_id),
  foreign key (customer_id, organization_id) references public.customers (id, organization_id),
  foreign key (quotation_id, organization_id) references public.quotations (id, organization_id),
  foreign key (invoice_id, organization_id) references public.invoices (id, organization_id),
  check ((status = 'draft') = (number is null)),
  check (status <> 'delivered' or delivered_at is not null),
  check (status <> 'cancelled' or cancelled_at is not null)
);
create unique index delivery_orders_org_number on public.delivery_orders (organization_id, number) where number is not null;
create index delivery_orders_org_date on public.delivery_orders (organization_id, issue_date desc);
create index delivery_orders_invoice on public.delivery_orders (invoice_id) where invoice_id is not null;
create trigger delivery_orders_touch before update on public.delivery_orders for each row execute function public.touch_updated_at();

create table public.delivery_order_items (
  id uuid primary key default gen_random_uuid(),
  delivery_order_id uuid not null references public.delivery_orders (id) on delete cascade,
  organization_id uuid not null references public.organizations (id) on delete cascade,
  position int not null,
  description text not null check (char_length(trim(description)) between 1 and 2000),
  quantity numeric(12, 3) not null check (quantity > 0),
  unit text check (char_length(unit) <= 20)
);
create index delivery_order_items_doc on public.delivery_order_items (delivery_order_id, position);

create or replace function public.protect_delivery_items() returns trigger
language plpgsql set search_path = public as $$
declare v_status public.delivery_status;
begin
  select status into v_status from public.delivery_orders where id = coalesce(new.delivery_order_id, old.delivery_order_id);
  if v_status is distinct from 'draft' and v_status is not null then
    raise exception 'only draft delivery orders can be edited' using errcode = 'check_violation';
  end if;
  return coalesce(new, old);
end $$;
create trigger delivery_order_items_protect before insert or update or delete on public.delivery_order_items
  for each row execute function public.protect_delivery_items();

-- Payload: {customer_id, issue_date, delivery_address, notes, items: [{description, quantity, unit?}]}
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

-- Creates a draft delivery order from a quotation or an invoice (items, customer and delivery address copied).
create or replace function public.create_delivery_order_from(p_source text, p_id uuid) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_org uuid; v_customer uuid; v_do uuid; v_addr text;
begin
  if p_source = 'invoice' then
    select organization_id, customer_id into v_org, v_customer from public.invoices where id = p_id;
  elsif p_source = 'quotation' then
    select organization_id, customer_id into v_org, v_customer from public.quotations where id = p_id;
  else
    raise exception 'invalid source' using errcode = 'check_violation';
  end if;
  if v_org is null then raise exception 'document not found' using errcode = 'no_data_found'; end if;
  perform public.require_member(v_org);
  select coalesce(delivery_address, billing_address) into v_addr from public.customers where id = v_customer;

  insert into public.delivery_orders (organization_id, customer_id, delivery_address, quotation_id, invoice_id, created_by)
  values (v_org, v_customer, v_addr, case when p_source = 'quotation' then p_id end,
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
  if d.customer_id is null then raise exception 'choose a customer first' using errcode = 'check_violation'; end if;
  if not exists (select 1 from public.delivery_order_items where delivery_order_id = p_id) then
    raise exception 'at least one item is required' using errcode = 'check_violation';
  end if;
  v_number := public.next_document_number(d.organization_id, 'delivery_order', d.issue_date);
  update public.delivery_orders set status = 'issued', number = v_number, issued_at = now(),
    customer_snapshot = public.customer_snapshot(d.customer_id)
  where id = p_id;
  insert into public.audit_logs (user_id, organization_id, action, entity, entity_id, metadata)
  values (auth.uid(), d.organization_id, 'delivery_order.issue', 'delivery_order', p_id, jsonb_build_object('number', v_number));
  return v_number;
end $$;

create or replace function public.mark_delivery_delivered(p_id uuid, p_date date, p_received_by text, p_notes text) returns void
language plpgsql security definer set search_path = public as $$
declare d record;
begin
  select * into d from public.delivery_orders where id = p_id for update;
  if not found then raise exception 'delivery order not found' using errcode = 'no_data_found'; end if;
  perform public.require_member(d.organization_id);
  if d.status <> 'issued' then raise exception 'only issued delivery orders can be marked delivered' using errcode = 'check_violation'; end if;
  if p_date is null or p_date > public.today_kl() + 1 then raise exception 'invalid delivery date' using errcode = 'check_violation'; end if;
  update public.delivery_orders set status = 'delivered', delivered_at = p_date,
    received_by = nullif(trim(p_received_by), ''), delivery_notes = nullif(trim(p_notes), '')
  where id = p_id;
  insert into public.audit_logs (user_id, organization_id, action, entity, entity_id)
  values (auth.uid(), d.organization_id, 'delivery_order.delivered', 'delivery_order', p_id);
end $$;

create or replace function public.cancel_delivery_order(p_id uuid, p_reason text) returns void
language plpgsql security definer set search_path = public as $$
declare d record;
begin
  select * into d from public.delivery_orders where id = p_id for update;
  if not found then raise exception 'delivery order not found' using errcode = 'no_data_found'; end if;
  perform public.require_member(d.organization_id);
  if d.status = 'cancelled' then return; end if;
  if d.status = 'delivered' then raise exception 'delivered orders cannot be cancelled' using errcode = 'check_violation'; end if;
  if char_length(trim(coalesce(p_reason, ''))) = 0 then raise exception 'a reason is required' using errcode = 'check_violation'; end if;
  if d.status = 'draft' then
    delete from public.delivery_orders where id = p_id;
  else
    update public.delivery_orders set status = 'cancelled', cancelled_at = now(), cancel_reason = trim(p_reason) where id = p_id;
  end if;
  insert into public.audit_logs (user_id, organization_id, action, entity, entity_id, metadata)
  values (auth.uid(), d.organization_id, case when d.status = 'draft' then 'delivery_order.discard' else 'delivery_order.cancel' end,
    'delivery_order', p_id, jsonb_build_object('reason', trim(p_reason)));
end $$;

revoke all on function public.save_delivery_order(uuid, uuid, jsonb) from public, anon;
revoke all on function public.create_delivery_order_from(text, uuid) from public, anon;
revoke all on function public.issue_delivery_order(uuid) from public, anon;
revoke all on function public.mark_delivery_delivered(uuid, date, text, text) from public, anon;
revoke all on function public.cancel_delivery_order(uuid, text) from public, anon;
grant execute on function public.save_delivery_order(uuid, uuid, jsonb) to authenticated;
grant execute on function public.create_delivery_order_from(text, uuid) to authenticated;
grant execute on function public.issue_delivery_order(uuid) to authenticated;
grant execute on function public.mark_delivery_delivered(uuid, date, text, text) to authenticated;
grant execute on function public.cancel_delivery_order(uuid, text) to authenticated;

alter table public.delivery_orders enable row level security;
alter table public.delivery_order_items enable row level security;
create policy delivery_orders_select on public.delivery_orders for select to authenticated using (public.is_org_member(organization_id));
create policy delivery_order_items_select on public.delivery_order_items for select to authenticated using (public.is_org_member(organization_id));

grant select on public.delivery_orders, public.delivery_order_items to authenticated;
grant all on public.delivery_orders, public.delivery_order_items to service_role;
revoke all on public.delivery_orders, public.delivery_order_items from anon;
