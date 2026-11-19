-- BukuTigaLima Phase 2: customers, products & services, quotations, invoices, payments, receipts.
--
-- Money rules (authoritative here; src/lib/documents.ts mirrors them for live preview only):
--   line gross     = round(quantity * unit_price, 2)
--   line subtotal  = line gross - line discount            (discount <= gross)
--   line tax       = round(line subtotal * tax_rate / 100, 2)
--   subtotal       = sum(line gross)
--   discount_total = sum(line discount)
--   charge amount  = fixed value, or round((subtotal - discount_total) * percent / 100, 2)   (charges are not taxed)
--   total          = subtotal - discount_total + charges_total + tax_total
--   outstanding    = invoice total - sum(valid payments)     (never stored; see invoice_balances)
--
-- Documents and payments are written ONLY through the SECURITY DEFINER functions below, which check membership,
-- lock rows where needed and allocate document numbers atomically. Tables are read-only for API users.

-- ---------------------------------------------------------------------------
-- Types
-- ---------------------------------------------------------------------------
create type public.quotation_status as enum ('draft', 'sent', 'accepted', 'rejected');
create type public.invoice_status as enum ('draft', 'issued', 'void');
create type public.collection_method as enum ('cash', 'bank_transfer', 'duitnow', 'card', 'cheque', 'ewallet', 'other');

-- Malaysia "today"
create or replace function public.today_kl() returns date
language sql stable set search_path = public as $$ select (now() at time zone 'Asia/Kuala_Lumpur')::date $$;

-- ---------------------------------------------------------------------------
-- customers
-- ---------------------------------------------------------------------------
create table public.customers (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  name text not null check (char_length(trim(name)) between 1 and 160),
  company_name text check (char_length(company_name) <= 160),
  registration_no text check (char_length(registration_no) <= 40),
  phone text check (char_length(phone) <= 40),
  email text check (char_length(email) <= 160),
  billing_address text check (char_length(billing_address) <= 500),
  delivery_address text check (char_length(delivery_address) <= 500),
  notes text check (char_length(notes) <= 1000),
  archived_at timestamptz,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, organization_id)
);
create index customers_org_name on public.customers (organization_id, lower(name));
create trigger customers_touch before update on public.customers for each row execute function public.touch_updated_at();

-- ---------------------------------------------------------------------------
-- products_services (catalog; documents copy description/price, so history never changes)
-- ---------------------------------------------------------------------------
create table public.products_services (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  kind text not null default 'service' check (kind in ('product', 'service')),
  name text not null check (char_length(trim(name)) between 1 and 160),
  description text check (char_length(description) <= 2000),
  sku text check (char_length(sku) <= 60),
  unit text not null default 'unit' check (char_length(unit) between 1 and 20),
  default_price numeric(14, 2) not null default 0 check (default_price >= 0 and default_price < 1000000000),
  tax_rate numeric(5, 2) not null default 0 check (tax_rate between 0 and 100),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, organization_id)
);
create index products_org_name on public.products_services (organization_id, lower(name));
create trigger products_touch before update on public.products_services for each row execute function public.touch_updated_at();

-- ---------------------------------------------------------------------------
-- document_sequences: per organization, document type and year
-- ---------------------------------------------------------------------------
create table public.document_sequences (
  organization_id uuid not null references public.organizations (id) on delete cascade,
  doc_type text not null check (doc_type in ('quotation', 'invoice', 'delivery_order', 'receipt')),
  year int not null check (year between 2000 and 2999),
  last_number int not null default 0 check (last_number >= 0),
  primary key (organization_id, doc_type, year)
);

-- Atomically allocates the next number, e.g. INV-2026-0001. Concurrent callers serialize on the row lock taken by
-- INSERT ... ON CONFLICT DO UPDATE, so numbers are unique and gap-free per (organization, type, year).
create or replace function public.next_document_number(p_org uuid, p_type text, p_date date)
returns text language plpgsql security definer set search_path = public as $$
declare
  v_year int := extract(year from p_date)::int;
  v_n int;
  v_prefix text;
begin
  insert into public.document_sequences (organization_id, doc_type, year, last_number)
  values (p_org, p_type, v_year, 1)
  on conflict (organization_id, doc_type, year) do update set last_number = public.document_sequences.last_number + 1
  returning last_number into v_n;
  select case p_type
           when 'quotation' then quotation_prefix
           when 'invoice' then invoice_prefix
           when 'delivery_order' then delivery_order_prefix
           else receipt_prefix end
    into v_prefix
  from public.organization_settings where organization_id = p_org;
  return coalesce(v_prefix, upper(left(p_type, 3))) || '-' || v_year || '-' || lpad(v_n::text, 4, '0');
end $$;
revoke all on function public.next_document_number(uuid, text, date) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- quotations
-- ---------------------------------------------------------------------------
create table public.quotations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  number text not null,
  status public.quotation_status not null default 'draft',
  customer_id uuid,
  customer_snapshot jsonb,
  issue_date date not null default public.today_kl(),
  valid_until date,
  title text check (char_length(title) <= 200),
  notes text check (char_length(notes) <= 2000),
  terms text check (char_length(terms) <= 4000),
  charges jsonb not null default '[]'::jsonb,
  subtotal numeric(14, 2) not null default 0,
  discount_total numeric(14, 2) not null default 0,
  charges_total numeric(14, 2) not null default 0,
  tax_total numeric(14, 2) not null default 0,
  total numeric(14, 2) not null default 0,
  converted_invoice_id uuid,
  sent_at timestamptz,
  decided_at timestamptz,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, number),
  unique (id, organization_id),
  foreign key (customer_id, organization_id) references public.customers (id, organization_id),
  check (valid_until is null or valid_until >= issue_date)
);
create index quotations_org_date on public.quotations (organization_id, issue_date desc);
create index quotations_customer on public.quotations (customer_id);
create trigger quotations_touch before update on public.quotations for each row execute function public.touch_updated_at();

create table public.quotation_items (
  id uuid primary key default gen_random_uuid(),
  quotation_id uuid not null references public.quotations (id) on delete cascade,
  organization_id uuid not null references public.organizations (id) on delete cascade,
  position int not null,
  product_id uuid,
  description text not null check (char_length(trim(description)) between 1 and 2000),
  quantity numeric(12, 3) not null check (quantity > 0),
  unit text check (char_length(unit) <= 20),
  unit_price numeric(14, 2) not null check (unit_price >= 0),
  discount_amount numeric(14, 2) not null default 0 check (discount_amount >= 0),
  tax_rate numeric(5, 2) not null default 0 check (tax_rate between 0 and 100),
  line_subtotal numeric(14, 2) not null,
  tax_amount numeric(14, 2) not null,
  line_total numeric(14, 2) not null,
  foreign key (product_id, organization_id) references public.products_services (id, organization_id) on delete set null (product_id)
);
create index quotation_items_doc on public.quotation_items (quotation_id, position);

-- ---------------------------------------------------------------------------
-- invoices
-- ---------------------------------------------------------------------------
create table public.invoices (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  number text,
  status public.invoice_status not null default 'draft',
  customer_id uuid,
  customer_snapshot jsonb,
  company_snapshot jsonb,
  invoice_date date not null default public.today_kl(),
  due_date date,
  quotation_id uuid,
  customer_po text check (char_length(customer_po) <= 80),
  payment_terms text check (char_length(payment_terms) <= 200),
  notes text check (char_length(notes) <= 2000),
  terms text check (char_length(terms) <= 4000),
  charges jsonb not null default '[]'::jsonb,
  subtotal numeric(14, 2) not null default 0,
  discount_total numeric(14, 2) not null default 0,
  charges_total numeric(14, 2) not null default 0,
  tax_total numeric(14, 2) not null default 0,
  total numeric(14, 2) not null default 0,
  issued_at timestamptz,
  voided_at timestamptz,
  void_reason text check (char_length(void_reason) <= 300),
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, organization_id),
  foreign key (customer_id, organization_id) references public.customers (id, organization_id),
  foreign key (quotation_id, organization_id) references public.quotations (id, organization_id),
  check (due_date is null or due_date >= invoice_date),
  check ((status = 'draft') = (number is null)),
  check (status <> 'void' or voided_at is not null)
);
create unique index invoices_org_number on public.invoices (organization_id, number) where number is not null;
create index invoices_org_date on public.invoices (organization_id, invoice_date desc);
create index invoices_customer on public.invoices (customer_id);
create index invoices_open on public.invoices (organization_id, due_date) where status = 'issued';
create trigger invoices_touch before update on public.invoices for each row execute function public.touch_updated_at();

alter table public.quotations
  add constraint quotations_converted_invoice_fk foreign key (converted_invoice_id, organization_id)
  references public.invoices (id, organization_id);

create table public.invoice_items (
  id uuid primary key default gen_random_uuid(),
  invoice_id uuid not null references public.invoices (id) on delete cascade,
  organization_id uuid not null references public.organizations (id) on delete cascade,
  position int not null,
  product_id uuid,
  description text not null check (char_length(trim(description)) between 1 and 2000),
  quantity numeric(12, 3) not null check (quantity > 0),
  unit text check (char_length(unit) <= 20),
  unit_price numeric(14, 2) not null check (unit_price >= 0),
  discount_amount numeric(14, 2) not null default 0 check (discount_amount >= 0),
  tax_rate numeric(5, 2) not null default 0 check (tax_rate between 0 and 100),
  line_subtotal numeric(14, 2) not null,
  tax_amount numeric(14, 2) not null,
  line_total numeric(14, 2) not null,
  foreign key (product_id, organization_id) references public.products_services (id, organization_id) on delete set null (product_id)
);
create index invoice_items_doc on public.invoice_items (invoice_id, position);

-- Issued invoices are immutable. The only allowed change is issued -> void (with reason).
create or replace function public.protect_issued_invoice() returns trigger
language plpgsql set search_path = public as $$
begin
  if old.status = 'draft' then return new; end if;
  if old.status = 'issued' and new.status = 'void'
     and new.number = old.number and new.total = old.total and new.subtotal = old.subtotal
     and new.tax_total = old.tax_total and new.discount_total = old.discount_total and new.charges_total = old.charges_total
     and new.customer_snapshot is not distinct from old.customer_snapshot
     and new.company_snapshot is not distinct from old.company_snapshot
     and new.invoice_date = old.invoice_date and new.due_date is not distinct from old.due_date then
    return new;
  end if;
  raise exception 'issued invoice % cannot be changed', old.number using errcode = 'check_violation';
end $$;
create trigger invoices_protect_issued before update on public.invoices for each row execute function public.protect_issued_invoice();

create or replace function public.protect_invoice_items() returns trigger
language plpgsql set search_path = public as $$
declare v_status public.invoice_status;
begin
  select status into v_status from public.invoices where id = coalesce(new.invoice_id, old.invoice_id);
  if v_status is distinct from 'draft' and v_status is not null then
    raise exception 'items of an issued invoice cannot be changed' using errcode = 'check_violation';
  end if;
  return coalesce(new, old);
end $$;
create trigger invoice_items_protect before insert or update or delete on public.invoice_items
  for each row execute function public.protect_invoice_items();

create or replace function public.protect_quotation_items() returns trigger
language plpgsql set search_path = public as $$
declare v_status public.quotation_status;
begin
  select status into v_status from public.quotations where id = coalesce(new.quotation_id, old.quotation_id);
  if v_status is distinct from 'draft' and v_status is not null then
    raise exception 'only draft quotations can be edited' using errcode = 'check_violation';
  end if;
  return coalesce(new, old);
end $$;
create trigger quotation_items_protect before insert or update or delete on public.quotation_items
  for each row execute function public.protect_quotation_items();

-- ---------------------------------------------------------------------------
-- payments & receipts
-- ---------------------------------------------------------------------------
create table public.payments (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  invoice_id uuid,
  customer_id uuid,
  amount numeric(14, 2) not null check (amount > 0 and amount < 1000000000),
  payment_date date not null,
  method public.collection_method not null,
  reference text check (char_length(reference) <= 120),
  description text check (char_length(description) <= 240),
  notes text check (char_length(notes) <= 1000),
  idempotency_key uuid not null,
  voided_at timestamptz,
  void_reason text check (char_length(void_reason) <= 300),
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  unique (organization_id, idempotency_key),
  unique (id, organization_id),
  foreign key (invoice_id, organization_id) references public.invoices (id, organization_id),
  foreign key (customer_id, organization_id) references public.customers (id, organization_id)
);
create index payments_org_date on public.payments (organization_id, payment_date desc);
create index payments_invoice on public.payments (invoice_id) where voided_at is null;

create table public.receipts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  payment_id uuid not null unique,
  number text not null,
  issued_at timestamptz not null default now(),
  voided_at timestamptz,
  unique (organization_id, number),
  foreign key (payment_id, organization_id) references public.payments (id, organization_id)
);

-- Outstanding balance always derived from the invoice and its valid payments.
create view public.invoice_balances with (security_invoker = true) as
select
  i.id as invoice_id,
  i.organization_id,
  i.total,
  coalesce(sum(p.amount) filter (where p.voided_at is null), 0)::numeric(14, 2) as amount_paid,
  (i.total - coalesce(sum(p.amount) filter (where p.voided_at is null), 0))::numeric(14, 2) as outstanding
from public.invoices i
left join public.payments p on p.invoice_id = i.id
group by i.id;

-- ---------------------------------------------------------------------------
-- Helpers for the write functions
-- ---------------------------------------------------------------------------
create or replace function public.require_member(p_org uuid) returns void
language plpgsql stable security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'not authenticated' using errcode = 'insufficient_privilege'; end if;
  if not public.is_org_member(p_org) then
    raise exception 'not a member of this business' using errcode = 'insufficient_privilege';
  end if;
end $$;
revoke all on function public.require_member(uuid) from public, anon, authenticated;

-- Validates and prices line items. Input: [{product_id?, description, quantity, unit?, unit_price, discount_amount?, tax_rate?}]
create or replace function public.price_items(p_items jsonb)
returns table (
  pos int, product_id uuid, description text, quantity numeric, unit text, unit_price numeric,
  discount_amount numeric, tax_rate numeric, line_gross numeric, line_subtotal numeric, tax_amount numeric, line_total numeric
)
language plpgsql immutable set search_path = public as $$
declare
  it jsonb;
  i int := 0;
  v_qty numeric; v_price numeric; v_disc numeric; v_rate numeric; v_gross numeric; v_sub numeric; v_tax numeric;
begin
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'at least one item is required' using errcode = 'check_violation';
  end if;
  if jsonb_array_length(p_items) > 200 then raise exception 'too many items' using errcode = 'check_violation'; end if;
  for it in select * from jsonb_array_elements(p_items) loop
    i := i + 1;
    v_qty := (it ->> 'quantity')::numeric;
    v_price := (it ->> 'unit_price')::numeric;
    v_disc := coalesce(nullif(it ->> 'discount_amount', '')::numeric, 0);
    v_rate := coalesce(nullif(it ->> 'tax_rate', '')::numeric, 0);
    if v_qty is null or v_qty <= 0 or v_qty <> round(v_qty, 3) then raise exception 'invalid quantity on line %', i using errcode = 'check_violation'; end if;
    if v_price is null or v_price < 0 or v_price <> round(v_price, 2) then raise exception 'invalid price on line %', i using errcode = 'check_violation'; end if;
    if v_disc < 0 or v_disc <> round(v_disc, 2) then raise exception 'invalid discount on line %', i using errcode = 'check_violation'; end if;
    if v_rate < 0 or v_rate > 100 or v_rate <> round(v_rate, 2) then raise exception 'invalid tax rate on line %', i using errcode = 'check_violation'; end if;
    if char_length(trim(coalesce(it ->> 'description', ''))) = 0 then raise exception 'description required on line %', i using errcode = 'check_violation'; end if;
    v_gross := round(v_qty * v_price, 2);
    if v_disc > v_gross then raise exception 'discount exceeds amount on line %', i using errcode = 'check_violation'; end if;
    v_sub := v_gross - v_disc;
    v_tax := round(v_sub * v_rate / 100, 2);
    pos := i;
    product_id := nullif(it ->> 'product_id', '')::uuid;
    description := trim(it ->> 'description');
    quantity := v_qty;
    unit := nullif(trim(coalesce(it ->> 'unit', '')), '');
    unit_price := v_price;
    discount_amount := v_disc;
    tax_rate := v_rate;
    line_gross := v_gross;
    line_subtotal := v_sub;
    tax_amount := v_tax;
    line_total := v_sub + v_tax;
    return next;
  end loop;
end $$;

-- Prices document charges (e.g. service charge). Input: [{label, kind: 'percent'|'fixed', value}]. Returns the
-- normalized array with "amount" per charge.
create or replace function public.price_charges(p_charges jsonb, p_base numeric)
returns jsonb language plpgsql immutable set search_path = public as $$
declare
  c jsonb;
  out jsonb := '[]'::jsonb;
  v_kind text; v_value numeric; v_amount numeric; v_label text;
begin
  if p_charges is null or jsonb_typeof(p_charges) <> 'array' then return out; end if;
  if jsonb_array_length(p_charges) > 10 then raise exception 'too many charges' using errcode = 'check_violation'; end if;
  for c in select * from jsonb_array_elements(p_charges) loop
    v_kind := coalesce(c ->> 'kind', 'fixed');
    v_value := (c ->> 'value')::numeric;
    v_label := trim(coalesce(c ->> 'label', ''));
    if char_length(v_label) = 0 or char_length(v_label) > 60 then raise exception 'charge label required' using errcode = 'check_violation'; end if;
    if v_kind not in ('percent', 'fixed') or v_value is null or v_value < 0 or v_value <> round(v_value, 2) then
      raise exception 'invalid charge' using errcode = 'check_violation';
    end if;
    if v_kind = 'percent' and v_value > 100 then raise exception 'invalid charge percent' using errcode = 'check_violation'; end if;
    v_amount := case when v_kind = 'percent' then round(p_base * v_value / 100, 2) else v_value end;
    out := out || jsonb_build_array(jsonb_build_object('label', v_label, 'kind', v_kind, 'value', v_value, 'amount', v_amount));
  end loop;
  return out;
end $$;

create or replace function public.customer_snapshot(p_customer uuid) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object('name', name, 'company_name', company_name, 'registration_no', registration_no,
    'phone', phone, 'email', email, 'billing_address', billing_address, 'delivery_address', delivery_address)
  from public.customers where id = p_customer
$$;
revoke all on function public.customer_snapshot(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Quotations
-- ---------------------------------------------------------------------------
-- Creates (p_id null) or updates a DRAFT quotation. Payload: {customer_id, issue_date, valid_until, title, notes,
-- terms, items: [...], charges: [...]}. Numbers are allocated on creation.
create or replace function public.save_quotation(p_org uuid, p_id uuid, p_payload jsonb) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_id uuid := p_id;
  v_issue date := coalesce(nullif(p_payload ->> 'issue_date', '')::date, public.today_kl());
  v_valid date := nullif(p_payload ->> 'valid_until', '')::date;
  v_customer uuid := nullif(p_payload ->> 'customer_id', '')::uuid;
  v_sub numeric; v_disc numeric; v_tax numeric; v_charges jsonb; v_charges_total numeric;
  v_status public.quotation_status;
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
    insert into public.quotations (organization_id, number, customer_id, issue_date, valid_until, title, notes, terms,
      charges, subtotal, discount_total, charges_total, tax_total, total, created_by)
    values (p_org, public.next_document_number(p_org, 'quotation', v_issue), v_customer, v_issue, v_valid,
      nullif(trim(p_payload ->> 'title'), ''), nullif(trim(p_payload ->> 'notes'), ''), nullif(trim(p_payload ->> 'terms'), ''),
      v_charges, v_sub, v_disc, v_charges_total, v_tax, v_sub - v_disc + v_charges_total + v_tax, auth.uid())
    returning id into v_id;
  else
    select status into v_status from public.quotations where id = v_id and organization_id = p_org for update;
    if not found then raise exception 'quotation not found' using errcode = 'no_data_found'; end if;
    if v_status <> 'draft' then raise exception 'only draft quotations can be edited' using errcode = 'check_violation'; end if;
    update public.quotations set customer_id = v_customer, issue_date = v_issue, valid_until = v_valid,
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
  if q.customer_id is null then raise exception 'choose a customer first' using errcode = 'check_violation'; end if;
  update public.quotations set status = p_status,
    customer_snapshot = coalesce(customer_snapshot, public.customer_snapshot(customer_id)),
    sent_at = case when p_status = 'sent' then coalesce(sent_at, now()) else sent_at end,
    decided_at = case when p_status in ('accepted', 'rejected') then now() else decided_at end
  where id = p_id;
  insert into public.audit_logs (user_id, organization_id, action, entity, entity_id, metadata)
  values (auth.uid(), q.organization_id, 'quotation.status', 'quotation', p_id, jsonb_build_object('status', p_status));
end $$;

-- Converts a quotation into a linked DRAFT invoice. Idempotent: a second call (double click, retry) returns the
-- same invoice. The quotation itself is preserved (only marked accepted and linked).
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
  if q.customer_id is null then raise exception 'choose a customer first' using errcode = 'check_violation'; end if;
  select payment_terms_days into v_terms from public.organization_settings where organization_id = q.organization_id;

  insert into public.invoices (organization_id, customer_id, invoice_date, due_date, quotation_id, notes, terms, charges,
    subtotal, discount_total, charges_total, tax_total, total, created_by)
  values (q.organization_id, q.customer_id, public.today_kl(), public.today_kl() + coalesce(v_terms, 30), q.id, q.notes, q.terms,
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
  insert into public.quotations (organization_id, number, customer_id, issue_date, valid_until, title, notes, terms, charges,
    subtotal, discount_total, charges_total, tax_total, total, created_by)
  values (q.organization_id, public.next_document_number(q.organization_id, 'quotation', public.today_kl()), q.customer_id,
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

-- ---------------------------------------------------------------------------
-- Invoices
-- ---------------------------------------------------------------------------
create or replace function public.save_invoice(p_org uuid, p_id uuid, p_payload jsonb) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_id uuid := p_id;
  v_date date := coalesce(nullif(p_payload ->> 'invoice_date', '')::date, public.today_kl());
  v_due date := nullif(p_payload ->> 'due_date', '')::date;
  v_customer uuid := nullif(p_payload ->> 'customer_id', '')::uuid;
  v_sub numeric; v_disc numeric; v_tax numeric; v_charges jsonb; v_charges_total numeric;
  v_status public.invoice_status;
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
    insert into public.invoices (organization_id, customer_id, invoice_date, due_date, customer_po, payment_terms, notes, terms,
      charges, subtotal, discount_total, charges_total, tax_total, total, created_by)
    values (p_org, v_customer, v_date, v_due, nullif(trim(p_payload ->> 'customer_po'), ''),
      nullif(trim(p_payload ->> 'payment_terms'), ''), nullif(trim(p_payload ->> 'notes'), ''), nullif(trim(p_payload ->> 'terms'), ''),
      v_charges, v_sub, v_disc, v_charges_total, v_tax, v_sub - v_disc + v_charges_total + v_tax, auth.uid())
    returning id into v_id;
  else
    select status into v_status from public.invoices where id = v_id and organization_id = p_org for update;
    if not found then raise exception 'invoice not found' using errcode = 'no_data_found'; end if;
    if v_status <> 'draft' then raise exception 'issued invoices cannot be edited' using errcode = 'check_violation'; end if;
    update public.invoices set customer_id = v_customer, invoice_date = v_date, due_date = v_due,
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

-- Issues a draft: allocates the number and freezes customer/company details. After this the invoice is immutable.
create or replace function public.issue_invoice(p_id uuid) returns text
language plpgsql security definer set search_path = public as $$
declare inv record; v_number text; v_company jsonb;
begin
  select * into inv from public.invoices where id = p_id for update;
  if not found then raise exception 'invoice not found' using errcode = 'no_data_found'; end if;
  perform public.require_member(inv.organization_id);
  if inv.status <> 'draft' then return inv.number; end if;  -- idempotent
  if inv.customer_id is null then raise exception 'choose a customer first' using errcode = 'check_violation'; end if;
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
    customer_snapshot = public.customer_snapshot(inv.customer_id), company_snapshot = v_company
  where id = p_id;
  insert into public.audit_logs (user_id, organization_id, action, entity, entity_id, metadata)
  values (auth.uid(), inv.organization_id, 'invoice.issue', 'invoice', p_id, jsonb_build_object('number', v_number));
  return v_number;
end $$;

-- Voids an issued invoice. Valid payments must be voided first, so totals can never disagree.
create or replace function public.void_invoice(p_id uuid, p_reason text) returns void
language plpgsql security definer set search_path = public as $$
declare inv record;
begin
  select * into inv from public.invoices where id = p_id for update;
  if not found then raise exception 'invoice not found' using errcode = 'no_data_found'; end if;
  perform public.require_member(inv.organization_id);
  if inv.status = 'void' then return; end if;
  if char_length(trim(coalesce(p_reason, ''))) = 0 then raise exception 'a reason is required' using errcode = 'check_violation'; end if;
  if inv.status = 'draft' then
    -- Drafts have no number: discard instead of voiding (and unlink the quotation so it can be converted again).
    update public.quotations set converted_invoice_id = null where converted_invoice_id = p_id;
    delete from public.invoices where id = p_id;
  else
    if exists (select 1 from public.payments where invoice_id = p_id and voided_at is null) then
      raise exception 'void the payments for this invoice first' using errcode = 'check_violation';
    end if;
    update public.invoices set status = 'void', voided_at = now(), void_reason = trim(p_reason) where id = p_id;
  end if;
  insert into public.audit_logs (user_id, organization_id, action, entity, entity_id, metadata)
  values (auth.uid(), inv.organization_id, case when inv.status = 'draft' then 'invoice.discard' else 'invoice.void' end,
          'invoice', p_id, jsonb_build_object('reason', trim(p_reason)));
end $$;

create or replace function public.duplicate_invoice(p_id uuid) returns uuid
language plpgsql security definer set search_path = public as $$
declare inv record; v_new uuid; v_terms int;
begin
  select * into inv from public.invoices where id = p_id;
  if not found then raise exception 'invoice not found' using errcode = 'no_data_found'; end if;
  perform public.require_member(inv.organization_id);
  select payment_terms_days into v_terms from public.organization_settings where organization_id = inv.organization_id;
  insert into public.invoices (organization_id, customer_id, invoice_date, due_date, customer_po, payment_terms, notes, terms,
    charges, subtotal, discount_total, charges_total, tax_total, total, created_by)
  values (inv.organization_id, inv.customer_id, public.today_kl(), public.today_kl() + coalesce(v_terms, 30), null,
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

-- ---------------------------------------------------------------------------
-- Payments
-- ---------------------------------------------------------------------------
-- Records a customer payment and issues its receipt in one transaction.
-- * p_invoice_id null = standalone payment (e.g. walk-in sale); a receipt is still issued.
-- * The invoice row is locked, so two simultaneous payments cannot both pass the "not more than outstanding" check.
-- * p_key (client-generated UUID) makes retries and double-clicks return the original payment instead of a duplicate.
create or replace function public.record_payment(
  p_org uuid,
  p_invoice_id uuid,
  p_customer_id uuid,
  p_amount numeric,
  p_date date,
  p_method public.collection_method,
  p_reference text,
  p_description text,
  p_notes text,
  p_key uuid
) returns table (payment_id uuid, receipt_id uuid, receipt_number text)
language plpgsql security definer set search_path = public as $$
#variable_conflict use_column
declare
  inv record;
  v_paid numeric;
  v_pay uuid;
  v_rc uuid;
  v_no text;
  v_customer uuid := p_customer_id;
begin
  perform public.require_member(p_org);
  if p_key is null then raise exception 'missing request key' using errcode = 'check_violation'; end if;

  -- Retry / double click: return what the first request created.
  select p.id, r.id, r.number into v_pay, v_rc, v_no
  from public.payments p left join public.receipts r on r.payment_id = p.id
  where p.organization_id = p_org and p.idempotency_key = p_key;
  if found then
    payment_id := v_pay; receipt_id := v_rc; receipt_number := v_no; return next; return;
  end if;

  if p_amount is null or p_amount <= 0 or p_amount <> round(p_amount, 2) then
    raise exception 'invalid amount' using errcode = 'check_violation';
  end if;
  if p_date is null or p_date > public.today_kl() + 1 then raise exception 'invalid payment date' using errcode = 'check_violation'; end if;

  if p_invoice_id is not null then
    select * into inv from public.invoices where id = p_invoice_id and organization_id = p_org for update;
    if not found then raise exception 'invoice not found' using errcode = 'no_data_found'; end if;
    if inv.status <> 'issued' then raise exception 'payments can only be recorded on issued invoices' using errcode = 'check_violation'; end if;
    select coalesce(sum(amount), 0) into v_paid from public.payments where invoice_id = p_invoice_id and voided_at is null;
    if p_amount > inv.total - v_paid then
      raise exception 'amount is more than the outstanding balance (%)', inv.total - v_paid using errcode = 'check_violation';
    end if;
    v_customer := inv.customer_id;
  elsif v_customer is not null and not exists (select 1 from public.customers where id = v_customer and organization_id = p_org) then
    raise exception 'customer not found' using errcode = 'foreign_key_violation';
  end if;

  insert into public.payments (organization_id, invoice_id, customer_id, amount, payment_date, method, reference, description,
    notes, idempotency_key, created_by)
  values (p_org, p_invoice_id, v_customer, p_amount, p_date, p_method, nullif(trim(p_reference), ''),
    nullif(trim(p_description), ''), nullif(trim(p_notes), ''), p_key, auth.uid())
  returning id into v_pay;

  v_no := public.next_document_number(p_org, 'receipt', p_date);
  insert into public.receipts (organization_id, payment_id, number) values (p_org, v_pay, v_no) returning id into v_rc;

  insert into public.audit_logs (user_id, organization_id, action, entity, entity_id, metadata)
  values (auth.uid(), p_org, 'payment.record', 'payment', v_pay,
          jsonb_build_object('invoice_id', p_invoice_id, 'receipt', v_no));
  payment_id := v_pay; receipt_id := v_rc; receipt_number := v_no;
  return next;
end $$;

-- Voids a payment and its receipt (kept for audit). The invoice balance is recalculated automatically.
create or replace function public.void_payment(p_payment_id uuid, p_reason text) returns void
language plpgsql security definer set search_path = public as $$
declare pay record;
begin
  select * into pay from public.payments where id = p_payment_id for update;
  if not found then raise exception 'payment not found' using errcode = 'no_data_found'; end if;
  perform public.require_member(pay.organization_id);
  if pay.voided_at is not null then return; end if;
  if char_length(trim(coalesce(p_reason, ''))) = 0 then raise exception 'a reason is required' using errcode = 'check_violation'; end if;
  if pay.invoice_id is not null then perform 1 from public.invoices where id = pay.invoice_id for update; end if;
  update public.payments set voided_at = now(), void_reason = trim(p_reason) where id = p_payment_id;
  update public.receipts set voided_at = now() where payment_id = p_payment_id;
  insert into public.audit_logs (user_id, organization_id, action, entity, entity_id, metadata)
  values (auth.uid(), pay.organization_id, 'payment.void', 'payment', p_payment_id, jsonb_build_object('reason', trim(p_reason)));
end $$;

-- Payments/receipts cannot be edited except through void_payment.
create or replace function public.protect_payment() returns trigger
language plpgsql set search_path = public as $$
begin
  if new.amount <> old.amount or new.invoice_id is distinct from old.invoice_id or new.payment_date <> old.payment_date
     or new.organization_id <> old.organization_id or new.idempotency_key <> old.idempotency_key
     or (old.voided_at is not null and new.voided_at is distinct from old.voided_at) then
    raise exception 'payments cannot be changed; void and record again' using errcode = 'check_violation';
  end if;
  return new;
end $$;
create trigger payments_protect before update on public.payments for each row execute function public.protect_payment();

-- ---------------------------------------------------------------------------
-- Function privileges
-- ---------------------------------------------------------------------------
revoke all on function public.save_quotation(uuid, uuid, jsonb) from public, anon;
revoke all on function public.set_quotation_status(uuid, public.quotation_status) from public, anon;
revoke all on function public.convert_quotation_to_invoice(uuid) from public, anon;
revoke all on function public.duplicate_quotation(uuid) from public, anon;
revoke all on function public.save_invoice(uuid, uuid, jsonb) from public, anon;
revoke all on function public.issue_invoice(uuid) from public, anon;
revoke all on function public.void_invoice(uuid, text) from public, anon;
revoke all on function public.duplicate_invoice(uuid) from public, anon;
revoke all on function public.record_payment(uuid, uuid, uuid, numeric, date, public.collection_method, text, text, text, uuid) from public, anon;
revoke all on function public.void_payment(uuid, text) from public, anon;
grant execute on function public.save_quotation(uuid, uuid, jsonb) to authenticated;
grant execute on function public.set_quotation_status(uuid, public.quotation_status) to authenticated;
grant execute on function public.convert_quotation_to_invoice(uuid) to authenticated;
grant execute on function public.duplicate_quotation(uuid) to authenticated;
grant execute on function public.save_invoice(uuid, uuid, jsonb) to authenticated;
grant execute on function public.issue_invoice(uuid) to authenticated;
grant execute on function public.void_invoice(uuid, text) to authenticated;
grant execute on function public.duplicate_invoice(uuid) to authenticated;
grant execute on function public.record_payment(uuid, uuid, uuid, numeric, date, public.collection_method, text, text, text, uuid) to authenticated;
grant execute on function public.void_payment(uuid, text) to authenticated;
grant execute on function public.price_items(jsonb) to authenticated;
grant execute on function public.price_charges(jsonb, numeric) to authenticated;
grant execute on function public.today_kl() to authenticated;

-- ---------------------------------------------------------------------------
-- Row Level Security: members of the organization only
-- ---------------------------------------------------------------------------
alter table public.customers enable row level security;
alter table public.products_services enable row level security;
alter table public.document_sequences enable row level security;
alter table public.quotations enable row level security;
alter table public.quotation_items enable row level security;
alter table public.invoices enable row level security;
alter table public.invoice_items enable row level security;
alter table public.payments enable row level security;
alter table public.receipts enable row level security;

create policy customers_select on public.customers for select to authenticated using (public.is_org_member(organization_id));
create policy customers_insert on public.customers for insert to authenticated with check (public.is_org_member(organization_id));
create policy customers_update on public.customers for update to authenticated
  using (public.is_org_member(organization_id)) with check (public.is_org_member(organization_id));

create policy products_select on public.products_services for select to authenticated using (public.is_org_member(organization_id));
create policy products_insert on public.products_services for insert to authenticated with check (public.is_org_member(organization_id));
create policy products_update on public.products_services for update to authenticated
  using (public.is_org_member(organization_id)) with check (public.is_org_member(organization_id));

create policy sequences_select on public.document_sequences for select to authenticated using (public.is_org_member(organization_id));
create policy quotations_select on public.quotations for select to authenticated using (public.is_org_member(organization_id));
create policy quotation_items_select on public.quotation_items for select to authenticated using (public.is_org_member(organization_id));
create policy invoices_select on public.invoices for select to authenticated using (public.is_org_member(organization_id));
create policy invoice_items_select on public.invoice_items for select to authenticated using (public.is_org_member(organization_id));
create policy payments_select on public.payments for select to authenticated using (public.is_org_member(organization_id));
create policy receipts_select on public.receipts for select to authenticated using (public.is_org_member(organization_id));

grant select, insert, update on public.customers, public.products_services to authenticated;
grant select on public.document_sequences, public.quotations, public.quotation_items, public.invoices, public.invoice_items,
  public.payments, public.receipts, public.invoice_balances to authenticated;
grant all on public.customers, public.products_services, public.document_sequences, public.quotations, public.quotation_items,
  public.invoices, public.invoice_items, public.payments, public.receipts to service_role;
grant select on public.invoice_balances to service_role;
revoke all on public.customers, public.products_services, public.document_sequences, public.quotations, public.quotation_items,
  public.invoices, public.invoice_items, public.payments, public.receipts, public.invoice_balances from anon;
