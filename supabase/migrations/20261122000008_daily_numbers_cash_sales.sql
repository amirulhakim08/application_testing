-- BukuTigaLima: (1) daily document numbers PREFIX-YYMMDDNNN for every document type, e.g. INV-261023001
-- (the 1st invoice on 23 Oct 2026; restarts at 001 every day, grows to 4+ digits after 999 so it never wraps);
-- (2) direct sales receipts ("cash sales"): items like an invoice, paid at once, no invoice created.
-- Numbers already issued in the old PREFIX-YYYY-NNNN format stay as they are.

-- ---------------------------------------------------------------------------
-- 1. Daily numbering
-- ---------------------------------------------------------------------------
alter table public.document_sequences drop constraint document_sequences_pkey;
alter table public.document_sequences add column id bigint generated always as identity primary key;
alter table public.document_sequences add column seq_date date;
-- Old yearly counters (seq_date null) are kept for history only.
create unique index document_sequences_yearly on public.document_sequences (organization_id, doc_type, year) where seq_date is null;
create unique index document_sequences_daily on public.document_sequences (organization_id, doc_type, seq_date) where seq_date is not null;

create or replace function public.next_document_number(p_org uuid, p_type text, p_date date)
returns text language plpgsql security definer set search_path = public as $$
declare
  v_day date := coalesce(p_date, public.today_kl());
  v_n int;
  v_prefix text;
begin
  -- Concurrent callers serialize on the row lock taken by INSERT ... ON CONFLICT DO UPDATE: unique and gap-free per day.
  insert into public.document_sequences (organization_id, doc_type, year, seq_date, last_number)
  values (p_org, p_type, extract(year from v_day)::int, v_day, 1)
  on conflict (organization_id, doc_type, seq_date) where seq_date is not null
  do update set last_number = public.document_sequences.last_number + 1
  returning last_number into v_n;
  select case p_type
           when 'quotation' then quotation_prefix
           when 'invoice' then invoice_prefix
           when 'delivery_order' then delivery_order_prefix
           else receipt_prefix end
    into v_prefix
  from public.organization_settings where organization_id = p_org;
  return coalesce(v_prefix, upper(left(p_type, 3))) || '-' || to_char(v_day, 'YYMMDD')
    || case when v_n < 1000 then lpad(v_n::text, 3, '0') else v_n::text end;
end $$;
revoke all on function public.next_document_number(uuid, text, date) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 2. Direct sales receipts
-- ---------------------------------------------------------------------------
create table public.cash_sales (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  payment_id uuid not null unique,
  customer_id uuid,
  customer_snapshot jsonb,
  sale_date date not null,
  notes text check (char_length(notes) <= 2000),
  charges jsonb not null default '[]'::jsonb,
  subtotal numeric(14, 2) not null,
  discount_total numeric(14, 2) not null,
  charges_total numeric(14, 2) not null,
  tax_total numeric(14, 2) not null,
  total numeric(14, 2) not null check (total > 0),
  company_snapshot jsonb,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  unique (id, organization_id),
  foreign key (payment_id, organization_id) references public.payments (id, organization_id),
  foreign key (customer_id, organization_id) references public.customers (id, organization_id)
);
create index cash_sales_org_date on public.cash_sales (organization_id, sale_date desc);

create table public.cash_sale_items (
  id uuid primary key default gen_random_uuid(),
  cash_sale_id uuid not null references public.cash_sales (id) on delete cascade,
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
create index cash_sale_items_doc on public.cash_sale_items (cash_sale_id, position);

-- A sale is a receipt: never edited. Mistakes are corrected by voiding the payment (void_payment) and issuing a new one.
create or replace function public.prevent_cash_sale_change() returns trigger
language plpgsql set search_path = public as $$
begin
  raise exception 'issued receipts cannot be edited' using errcode = 'check_violation';
end $$;
create trigger cash_sales_immutable before update on public.cash_sales for each row execute function public.prevent_cash_sale_change();
create trigger cash_sale_items_immutable before update on public.cash_sale_items for each row execute function public.prevent_cash_sale_change();

-- Payload: {customer_id?, sale_date, method, reference?, notes?, items: [...like invoices], charges: [...]}.
-- p_key makes retries / double clicks return the first sale instead of creating a second one.
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
  values (p_org, v_pay, v_customer, case when v_customer is not null then public.customer_snapshot(v_customer) end, v_date,
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
revoke all on function public.record_cash_sale(uuid, jsonb, uuid) from public, anon;
grant execute on function public.record_cash_sale(uuid, jsonb, uuid) to authenticated;
revoke all on function public.prevent_cash_sale_change() from public, anon, authenticated;

alter table public.cash_sales enable row level security;
alter table public.cash_sale_items enable row level security;
create policy cash_sales_select on public.cash_sales for select to authenticated using (public.is_org_member(organization_id));
create policy cash_sale_items_select on public.cash_sale_items for select to authenticated using (public.is_org_member(organization_id));
grant select on public.cash_sales, public.cash_sale_items to authenticated;
grant all on public.cash_sales, public.cash_sale_items to service_role;
revoke all on public.cash_sales, public.cash_sale_items from anon;
