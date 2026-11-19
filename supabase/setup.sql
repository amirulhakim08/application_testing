-- BukuTigaLima: all migrations combined, for pasting into the Supabase SQL Editor in one go.
-- Only for projects WITHOUT the GitHub integration. Run once on a new project.

-- ===== 20261114000001_init.sql =====
-- KiraGo initial schema
-- Expense tracking only. Totals are always derived from saved rows in public.expenses.

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------------
create type public.workspace_kind as enum ('personal', 'company');
create type public.entry_method as enum ('receipt_scan', 'voice', 'manual');
create type public.receipt_retention as enum ('keep', 'days_90', 'none');
create type public.ai_usage_kind as enum ('receipt_scan', 'transcription', 'voice_parse');

-- ---------------------------------------------------------------------------
-- profiles
-- ---------------------------------------------------------------------------
create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  full_name text check (char_length(full_name) <= 120),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- workspaces
-- MVP: exactly one personal and one company workspace per user.
-- The company uniqueness lives in a partial index so it can be dropped later
-- to support multiple companies without schema changes.
-- ---------------------------------------------------------------------------
create table public.workspaces (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users (id) on delete cascade,
  kind public.workspace_kind not null,
  name text not null check (char_length(name) between 1 and 80),
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, owner_id)
);
create unique index workspaces_one_personal on public.workspaces (owner_id) where kind = 'personal';
create unique index workspaces_one_company_mvp on public.workspaces (owner_id) where kind = 'company';

-- ---------------------------------------------------------------------------
-- expense_categories (scoped to a workspace)
-- ---------------------------------------------------------------------------
create table public.expense_categories (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  workspace_id uuid not null,
  name text not null check (char_length(name) between 1 and 40),
  icon text,
  sort_order int not null default 0,
  is_system boolean not null default false,
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, workspace_id),
  foreign key (workspace_id, user_id) references public.workspaces (id, owner_id) on delete cascade
);
create unique index expense_categories_unique_name
  on public.expense_categories (workspace_id, lower(name)) where archived_at is null;

-- ---------------------------------------------------------------------------
-- receipt_files (private storage objects)
-- ---------------------------------------------------------------------------
create table public.receipt_files (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  storage_path text not null unique,
  mime_type text not null check (mime_type in ('image/jpeg', 'image/png', 'image/webp')),
  size_bytes int not null check (size_bytes > 0 and size_bytes <= 10485760),
  sha256 text not null check (sha256 ~ '^[0-9a-f]{64}$'),
  -- Set when an expense referencing this file is saved. Unattached files are temporary.
  attached_at timestamptz,
  deleted_at timestamptz,
  created_at timestamptz not null default now()
);
create index receipt_files_user_sha on public.receipt_files (user_id, sha256);

-- ---------------------------------------------------------------------------
-- ai_extraction_results (raw validated AI output; never affects totals)
-- ---------------------------------------------------------------------------
create table public.ai_extraction_results (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  source public.entry_method not null check (source in ('receipt_scan', 'voice')),
  receipt_file_id uuid references public.receipt_files (id) on delete set null,
  image_sha256 text,
  provider text not null,
  model text,
  result jsonb not null,
  overall_confidence numeric(4, 3) check (overall_confidence between 0 and 1),
  needs_review boolean not null default true,
  created_at timestamptz not null default now()
);
create index ai_extraction_results_user_sha on public.ai_extraction_results (user_id, image_sha256);

-- ---------------------------------------------------------------------------
-- expenses
-- ---------------------------------------------------------------------------
create table public.expenses (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  workspace_id uuid not null,
  category_id uuid,
  amount numeric(14, 2) not null check (amount > 0 and amount < 1000000000),
  currency char(3) not null default 'MYR' check (currency ~ '^[A-Z]{3}$'),
  merchant text check (char_length(merchant) <= 120),
  description text check (char_length(description) <= 240),
  notes text check (char_length(notes) <= 1000),
  expense_date date not null,
  expense_time time,
  tax_amount numeric(14, 2) check (tax_amount >= 0),
  discount_amount numeric(14, 2) check (discount_amount >= 0),
  entry_method public.entry_method not null,
  receipt_file_id uuid references public.receipt_files (id) on delete set null,
  ai_extraction_id uuid references public.ai_extraction_results (id) on delete set null,
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- Workspace must belong to the same user.
  foreign key (workspace_id, user_id) references public.workspaces (id, owner_id) on delete cascade,
  -- Category must belong to the same workspace as the expense.
  foreign key (category_id, workspace_id) references public.expense_categories (id, workspace_id)
);
create index expenses_user_date on public.expenses (user_id, expense_date desc) where deleted_at is null;
create index expenses_workspace_date on public.expenses (workspace_id, expense_date desc) where deleted_at is null;
create index expenses_dup_lookup on public.expenses (user_id, expense_date, amount) where deleted_at is null;

-- Line items extracted from receipts (optional, informational only)
create table public.expense_items (
  id uuid primary key default gen_random_uuid(),
  expense_id uuid not null references public.expenses (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  name text not null check (char_length(name) <= 160),
  quantity numeric(10, 3),
  amount numeric(14, 2),
  position int not null default 0
);
create index expense_items_expense on public.expense_items (expense_id);

-- ---------------------------------------------------------------------------
-- user_preferences
-- ---------------------------------------------------------------------------
create table public.user_preferences (
  user_id uuid primary key references auth.users (id) on delete cascade,
  language text not null default 'en' check (language in ('en', 'ms')),
  theme text not null default 'system' check (theme in ('system', 'light', 'dark')),
  currency char(3) not null default 'MYR' check (currency ~ '^[A-Z]{3}$'),
  receipt_retention public.receipt_retention not null default 'keep',
  last_workspace_id uuid references public.workspaces (id) on delete set null,
  last_category_by_workspace jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- audit_logs (no financial content beyond ids; append-only for users)
-- ---------------------------------------------------------------------------
create table public.audit_logs (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  action text not null,
  entity text not null,
  entity_id uuid,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index audit_logs_user on public.audit_logs (user_id, created_at desc);

-- ---------------------------------------------------------------------------
-- ai_usage_events (usage monitoring + rate limiting)
-- ---------------------------------------------------------------------------
create table public.ai_usage_events (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  kind public.ai_usage_kind not null,
  provider text not null,
  success boolean not null,
  cached boolean not null default false,
  error_code text,
  duration_ms int,
  created_at timestamptz not null default now()
);
create index ai_usage_events_user_kind_time on public.ai_usage_events (user_id, kind, created_at desc);

-- ---------------------------------------------------------------------------
-- updated_at trigger
-- ---------------------------------------------------------------------------
create or replace function public.touch_updated_at() returns trigger
language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;

create trigger profiles_touch before update on public.profiles for each row execute function public.touch_updated_at();
create trigger workspaces_touch before update on public.workspaces for each row execute function public.touch_updated_at();
create trigger categories_touch before update on public.expense_categories for each row execute function public.touch_updated_at();
create trigger expenses_touch before update on public.expenses for each row execute function public.touch_updated_at();
create trigger prefs_touch before update on public.user_preferences for each row execute function public.touch_updated_at();

-- Prevent moving rows between users.
create or replace function public.forbid_user_change() returns trigger
language plpgsql as $$
begin
  if new.user_id is distinct from old.user_id then
    raise exception 'user_id cannot be changed';
  end if;
  return new;
end $$;
create trigger expenses_user_immutable before update on public.expenses for each row execute function public.forbid_user_change();
create trigger categories_user_immutable before update on public.expense_categories for each row execute function public.forbid_user_change();

-- ---------------------------------------------------------------------------
-- Onboarding: create profile, preferences, workspaces, default categories
-- ---------------------------------------------------------------------------
create or replace function public.seed_user(p_user_id uuid, p_full_name text, p_company_name text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_personal uuid;
  v_company uuid;
  personal_categories text[] := array['Food & Drinks','Groceries','Transport','Bills','Shopping','Entertainment','Healthcare','Education','Travel','Family','Other'];
  personal_icons text[] := array['utensils','shopping-basket','car','receipt','shopping-bag','clapperboard','heart-pulse','graduation-cap','plane','users','circle-ellipsis'];
  company_categories text[] := array['Supplies','Inventory Purchases','Packaging','Shipping','Marketing','Advertising','Staff Expenses','Travel','Software','Rent','Utilities','Professional Fees','Other'];
  company_icons text[] := array['paperclip','boxes','package','truck','megaphone','badge-percent','users','plane','laptop','building','zap','briefcase','circle-ellipsis'];
  i int;
begin
  insert into public.profiles (id, full_name) values (p_user_id, nullif(trim(p_full_name), ''))
  on conflict (id) do nothing;

  insert into public.workspaces (owner_id, kind, name) values (p_user_id, 'personal', 'Personal')
  on conflict do nothing;
  insert into public.workspaces (owner_id, kind, name)
  values (p_user_id, 'company', coalesce(nullif(trim(p_company_name), ''), 'Company'))
  on conflict do nothing;

  select id into v_personal from public.workspaces where owner_id = p_user_id and kind = 'personal';
  select id into v_company from public.workspaces where owner_id = p_user_id and kind = 'company' order by created_at limit 1;

  if not exists (select 1 from public.expense_categories where workspace_id = v_personal) then
    for i in 1 .. array_length(personal_categories, 1) loop
      insert into public.expense_categories (user_id, workspace_id, name, icon, sort_order, is_system)
      values (p_user_id, v_personal, personal_categories[i], personal_icons[i], i, personal_categories[i] = 'Other');
    end loop;
  end if;

  if not exists (select 1 from public.expense_categories where workspace_id = v_company) then
    for i in 1 .. array_length(company_categories, 1) loop
      insert into public.expense_categories (user_id, workspace_id, name, icon, sort_order, is_system)
      values (p_user_id, v_company, company_categories[i], company_icons[i], i, company_categories[i] = 'Other');
    end loop;
  end if;

  insert into public.user_preferences (user_id, last_workspace_id) values (p_user_id, v_personal)
  on conflict (user_id) do nothing;
end $$;

revoke all on function public.seed_user(uuid, text, text) from public, anon, authenticated;

create or replace function public.handle_new_user() returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.seed_user(
    new.id,
    new.raw_user_meta_data ->> 'full_name',
    new.raw_user_meta_data ->> 'company_name'
  );
  return new;
end $$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Self-heal for users created before the trigger existed. Only seeds the caller.
create or replace function public.ensure_my_workspaces() returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'not authenticated';
  end if;
  perform public.seed_user(auth.uid(), null, null);
end $$;
revoke all on function public.ensure_my_workspaces() from public, anon;
grant execute on function public.ensure_my_workspaces() to authenticated;

-- ---------------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------------
alter table public.profiles enable row level security;
alter table public.workspaces enable row level security;
alter table public.expense_categories enable row level security;
alter table public.receipt_files enable row level security;
alter table public.ai_extraction_results enable row level security;
alter table public.expenses enable row level security;
alter table public.expense_items enable row level security;
alter table public.user_preferences enable row level security;
alter table public.audit_logs enable row level security;
alter table public.ai_usage_events enable row level security;

create policy profiles_own on public.profiles
  for all to authenticated using (id = auth.uid()) with check (id = auth.uid());

-- Workspaces are created by onboarding only; users may read and rename/archive.
create policy workspaces_select on public.workspaces
  for select to authenticated using (owner_id = auth.uid());
create policy workspaces_update on public.workspaces
  for update to authenticated using (owner_id = auth.uid()) with check (owner_id = auth.uid());

create policy categories_own on public.expense_categories
  for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

create policy receipt_files_own on public.receipt_files
  for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

create policy ai_results_own on public.ai_extraction_results
  for all to authenticated
  using (user_id = auth.uid())
  with check (
    user_id = auth.uid()
    and (receipt_file_id is null or exists (
      select 1 from public.receipt_files r where r.id = receipt_file_id and r.user_id = auth.uid()))
  );

create policy expenses_own on public.expenses
  for all to authenticated
  using (user_id = auth.uid())
  with check (
    user_id = auth.uid()
    -- Foreign keys bypass RLS, so make sure referenced receipts/extractions are the caller's own.
    and (receipt_file_id is null or exists (
      select 1 from public.receipt_files r where r.id = receipt_file_id and r.user_id = auth.uid()))
    and (ai_extraction_id is null or exists (
      select 1 from public.ai_extraction_results a where a.id = ai_extraction_id and a.user_id = auth.uid()))
  );

create policy expense_items_own on public.expense_items
  for all to authenticated
  using (user_id = auth.uid())
  with check (
    user_id = auth.uid()
    and exists (select 1 from public.expenses e where e.id = expense_id and e.user_id = auth.uid())
  );

create policy prefs_own on public.user_preferences
  for all to authenticated
  using (user_id = auth.uid())
  with check (
    user_id = auth.uid()
    and (last_workspace_id is null or exists (
      select 1 from public.workspaces w where w.id = last_workspace_id and w.owner_id = auth.uid()))
  );

create policy audit_select on public.audit_logs
  for select to authenticated using (user_id = auth.uid());
create policy audit_insert on public.audit_logs
  for insert to authenticated with check (user_id = auth.uid());

create policy usage_select on public.ai_usage_events
  for select to authenticated using (user_id = auth.uid());
create policy usage_insert on public.ai_usage_events
  for insert to authenticated with check (user_id = auth.uid());

-- Anonymous users get nothing.
revoke all on all tables in schema public from anon;


-- ===== 20261114000002_storage.sql =====
-- Private bucket for receipt images. Objects live under "<user_id>/<file>".
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('receipts', 'receipts', false, 10485760, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update set public = false;

create policy "receipts_select_own" on storage.objects
  for select to authenticated
  using (bucket_id = 'receipts' and (storage.foldername(name))[1] = auth.uid()::text);

create policy "receipts_insert_own" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'receipts' and (storage.foldername(name))[1] = auth.uid()::text);

create policy "receipts_delete_own" on storage.objects
  for delete to authenticated
  using (bucket_id = 'receipts' and (storage.foldername(name))[1] = auth.uid()::text);


-- ===== 20261114000003_explicit_grants.sql =====
-- Explicit Data API privileges, so the app works even when the Supabase project
-- was created with "Automatically expose new tables" turned OFF.
-- Row Level Security (enabled in the init migration) still limits every row to its owner.
grant usage on schema public to authenticated, service_role;

grant select, insert, update, delete on
  public.profiles,
  public.workspaces,
  public.expense_categories,
  public.receipt_files,
  public.ai_extraction_results,
  public.expenses,
  public.expense_items,
  public.user_preferences,
  public.audit_logs,
  public.ai_usage_events
to authenticated;

grant all on all tables in schema public to service_role;
grant usage, select on all sequences in schema public to authenticated, service_role;

-- Anonymous visitors get nothing.
revoke all on all tables in schema public from anon;


-- ===== 20261114000004_harden_functions.sql =====
-- Security Advisor fixes:
-- 1) pin search_path on trigger helper functions
-- 2) trigger-only SECURITY DEFINER function must not be callable through the API
-- (ensure_my_workspaces stays callable by signed-in users on purpose: it only seeds the caller's own data.)
alter function public.touch_updated_at() set search_path = public;
alter function public.forbid_user_change() set search_path = public;
revoke all on function public.handle_new_user() from public, anon, authenticated;


-- ===== 20261119000005_organizations.sql =====
-- BukuTigaLima foundation
-- * Business organizations with members (MVP: Owner role only in the UI).
-- * Expenses get an explicit scope: PERSONAL (belongs to one user) or BUSINESS (belongs to one organization).
--
-- This replaces KiraGo's per-user "workspaces". The KiraGo tables held test data only and the owner approved a
-- reset (2026-11-19), so the expense tables are recreated rather than migrated.

-- ---------------------------------------------------------------------------
-- Drop the workspace-based expense model
-- ---------------------------------------------------------------------------
drop function if exists public.ensure_my_workspaces();
drop trigger if exists on_auth_user_created on auth.users;
drop function if exists public.handle_new_user();
drop function if exists public.seed_user(uuid, text, text);

drop table if exists public.expense_items cascade;
drop table if exists public.expenses cascade;
drop table if exists public.expense_categories cascade;
drop policy if exists prefs_own on public.user_preferences;
alter table public.user_preferences drop column if exists last_workspace_id;
drop table if exists public.workspaces cascade;
drop type if exists public.workspace_kind;

-- ---------------------------------------------------------------------------
-- Types
-- ---------------------------------------------------------------------------
create type public.org_role as enum ('owner', 'admin', 'staff');
create type public.expense_scope as enum ('personal', 'business');
create type public.payment_method as enum ('cash', 'debit_card', 'credit_card', 'online_banking', 'ewallet', 'other');

-- ---------------------------------------------------------------------------
-- organizations
-- ---------------------------------------------------------------------------
create table public.organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 1 and 120),
  registration_no text check (char_length(registration_no) <= 40),
  address text check (char_length(address) <= 400),
  email text check (char_length(email) <= 160),
  phone text check (char_length(phone) <= 40),
  website text check (char_length(website) <= 200),
  logo_path text check (char_length(logo_path) <= 300),
  bank_name text check (char_length(bank_name) <= 80),
  bank_account_no text check (char_length(bank_account_no) <= 40),
  bank_account_holder text check (char_length(bank_account_holder) <= 120),
  created_by uuid references auth.users (id) on delete set null,
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.organization_members (
  organization_id uuid not null references public.organizations (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  role public.org_role not null default 'staff',
  created_at timestamptz not null default now(),
  primary key (organization_id, user_id)
);
create index organization_members_user on public.organization_members (user_id);

create table public.organization_settings (
  organization_id uuid primary key references public.organizations (id) on delete cascade,
  document_template text not null default 'modern' check (document_template in ('classic', 'modern', 'navy')),
  quotation_prefix text not null default 'QT' check (quotation_prefix ~ '^[A-Z0-9]{1,8}$'),
  invoice_prefix text not null default 'INV' check (invoice_prefix ~ '^[A-Z0-9]{1,8}$'),
  delivery_order_prefix text not null default 'DO' check (delivery_order_prefix ~ '^[A-Z0-9]{1,8}$'),
  receipt_prefix text not null default 'RC' check (receipt_prefix ~ '^[A-Z0-9]{1,8}$'),
  payment_terms_days int not null default 30 check (payment_terms_days between 0 and 365),
  quotation_validity_days int not null default 30 check (quotation_validity_days between 1 and 365),
  tax_label text not null default 'SST' check (char_length(tax_label) between 1 and 20),
  default_tax_rate numeric(5, 2) not null default 0 check (default_tax_rate between 0 and 100),
  tax_registration_no text check (char_length(tax_registration_no) <= 40),
  default_notes text check (char_length(default_notes) <= 1000),
  default_terms text check (char_length(default_terms) <= 2000),
  onboarding_completed_at timestamptz,
  updated_at timestamptz not null default now()
);

create trigger organizations_touch before update on public.organizations for each row execute function public.touch_updated_at();
create trigger org_settings_touch before update on public.organization_settings for each row execute function public.touch_updated_at();

-- Membership helpers. SECURITY DEFINER so policies on other tables can call them without recursing into
-- organization_members' own policies. They only ever answer for the calling user (auth.uid()).
create or replace function public.is_org_member(p_org uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.organization_members m
    where m.organization_id = p_org and m.user_id = auth.uid()
  )
$$;

create or replace function public.has_org_role(p_org uuid, p_roles public.org_role[]) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.organization_members m
    where m.organization_id = p_org and m.user_id = auth.uid() and m.role = any (p_roles)
  )
$$;

revoke all on function public.is_org_member(uuid) from public, anon;
revoke all on function public.has_org_role(uuid, public.org_role[]) from public, anon;
grant execute on function public.is_org_member(uuid) to authenticated;
grant execute on function public.has_org_role(uuid, public.org_role[]) to authenticated;

-- ---------------------------------------------------------------------------
-- expense_categories: personal (owned by a user) or business (owned by an organization)
-- ---------------------------------------------------------------------------
create table public.expense_categories (
  id uuid primary key default gen_random_uuid(),
  scope public.expense_scope not null,
  user_id uuid references auth.users (id) on delete cascade,
  organization_id uuid references public.organizations (id) on delete cascade,
  name text not null check (char_length(name) between 1 and 40),
  icon text,
  sort_order int not null default 0,
  is_system boolean not null default false,
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint expense_categories_owner check (
    (scope = 'personal' and user_id is not null and organization_id is null)
    or (scope = 'business' and organization_id is not null and user_id is null)
  )
);
create unique index expense_categories_unique_name
  on public.expense_categories (scope, coalesce(organization_id, user_id), lower(name)) where archived_at is null;
create index expense_categories_user on public.expense_categories (user_id) where user_id is not null;
create index expense_categories_org on public.expense_categories (organization_id) where organization_id is not null;
create trigger categories_touch before update on public.expense_categories for each row execute function public.touch_updated_at();

-- Owner of a category can never change (prevents moving a personal category into a business, or vice versa).
create or replace function public.forbid_category_owner_change() returns trigger
language plpgsql set search_path = public as $$
begin
  if new.scope is distinct from old.scope
     or new.user_id is distinct from old.user_id
     or new.organization_id is distinct from old.organization_id then
    raise exception 'category owner cannot be changed' using errcode = 'check_violation';
  end if;
  return new;
end $$;
create trigger categories_owner_immutable before update on public.expense_categories
  for each row execute function public.forbid_category_owner_change();

-- ---------------------------------------------------------------------------
-- expenses
-- user_id = who recorded it. Personal: only that user can see it. Business: members of organization_id.
-- ---------------------------------------------------------------------------
create table public.expenses (
  id uuid primary key default gen_random_uuid(),
  scope public.expense_scope not null,
  user_id uuid not null references auth.users (id) on delete cascade,
  organization_id uuid references public.organizations (id) on delete cascade,
  category_id uuid references public.expense_categories (id),
  amount numeric(14, 2) not null check (amount > 0 and amount < 1000000000),
  currency char(3) not null default 'MYR' check (currency ~ '^[A-Z]{3}$'),
  merchant text check (char_length(merchant) <= 120),
  description text check (char_length(description) <= 240),
  notes text check (char_length(notes) <= 1000),
  expense_date date not null,
  expense_time time,
  tax_amount numeric(14, 2) check (tax_amount >= 0),
  discount_amount numeric(14, 2) check (discount_amount >= 0),
  payment_method public.payment_method,
  entry_method public.entry_method not null,
  receipt_file_id uuid references public.receipt_files (id) on delete set null,
  ai_extraction_id uuid references public.ai_extraction_results (id) on delete set null,
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint expenses_owner check (
    (scope = 'personal' and organization_id is null)
    or (scope = 'business' and organization_id is not null)
  )
);
create index expenses_personal_date on public.expenses (user_id, expense_date desc) where deleted_at is null and scope = 'personal';
create index expenses_org_date on public.expenses (organization_id, expense_date desc) where deleted_at is null and scope = 'business';
create index expenses_dup_lookup on public.expenses (user_id, expense_date, amount) where deleted_at is null;
create trigger expenses_touch before update on public.expenses for each row execute function public.touch_updated_at();
create trigger expenses_user_immutable before update on public.expenses for each row execute function public.forbid_user_change();

-- The category must have the same scope and owner as the expense. (A plain FK cannot express this because
-- one of the owner columns is always NULL.) Raised as foreign_key_violation.
create or replace function public.check_expense_category() returns trigger
language plpgsql set search_path = public as $$
declare c record;
begin
  if new.category_id is null then return new; end if;
  select scope, user_id, organization_id into c from public.expense_categories where id = new.category_id;
  if not found
     or c.scope <> new.scope
     or (new.scope = 'personal' and c.user_id is distinct from new.user_id)
     or (new.scope = 'business' and c.organization_id is distinct from new.organization_id) then
    raise exception 'category does not belong to this expense scope' using errcode = 'foreign_key_violation';
  end if;
  return new;
end $$;
create trigger expenses_category_scope before insert or update of category_id, scope, organization_id, user_id
  on public.expenses for each row execute function public.check_expense_category();

create table public.expense_items (
  id uuid primary key default gen_random_uuid(),
  expense_id uuid not null references public.expenses (id) on delete cascade,
  name text not null check (char_length(name) <= 160),
  quantity numeric(10, 3),
  amount numeric(14, 2),
  position int not null default 0
);
create index expense_items_expense on public.expense_items (expense_id);

-- ---------------------------------------------------------------------------
-- user_preferences: remember last scope/organization; Bahasa Melayu by default
-- ---------------------------------------------------------------------------
alter table public.user_preferences alter column language set default 'ms';
alter table public.user_preferences add column last_scope public.expense_scope not null default 'personal';
alter table public.user_preferences add column last_organization_id uuid references public.organizations (id) on delete set null;
alter table public.user_preferences add column active_organization_id uuid references public.organizations (id) on delete set null;

-- audit_logs may now refer to an organization
alter table public.audit_logs add column organization_id uuid references public.organizations (id) on delete cascade;
create index audit_logs_org on public.audit_logs (organization_id, created_at desc) where organization_id is not null;

-- ---------------------------------------------------------------------------
-- New-user seeding: profile, preferences, personal categories. The business is created in onboarding.
-- ---------------------------------------------------------------------------
create or replace function public.seed_user(p_user_id uuid, p_full_name text, p_language text default null)
returns void language plpgsql security definer set search_path = public as $$
declare
  names text[] := array['Food & Drinks','Groceries','Fuel','Transport','Bills','Shopping','Education','Entertainment','Healthcare','Other'];
  icons text[] := array['utensils','shopping-basket','fuel','car','receipt','shopping-bag','graduation-cap','clapperboard','heart-pulse','circle-ellipsis'];
  i int;
begin
  insert into public.profiles (id, full_name) values (p_user_id, nullif(trim(p_full_name), ''))
  on conflict (id) do nothing;

  if not exists (select 1 from public.expense_categories where scope = 'personal' and user_id = p_user_id) then
    for i in 1 .. array_length(names, 1) loop
      insert into public.expense_categories (scope, user_id, name, icon, sort_order, is_system)
      values ('personal', p_user_id, names[i], icons[i], i, names[i] = 'Other');
    end loop;
  end if;

  insert into public.user_preferences (user_id, language)
  values (p_user_id, case when p_language in ('en', 'ms') then p_language else 'ms' end)
  on conflict (user_id) do nothing;
end $$;
revoke all on function public.seed_user(uuid, text, text) from public, anon, authenticated;

create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  perform public.seed_user(new.id, new.raw_user_meta_data ->> 'full_name', new.raw_user_meta_data ->> 'language');
  return new;
end $$;
revoke all on function public.handle_new_user() from public, anon, authenticated;

create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- Self-heal for users created before this migration. Only seeds the caller.
create or replace function public.ensure_my_profile() returns void
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  perform public.seed_user(auth.uid(), null);
end $$;
revoke all on function public.ensure_my_profile() from public, anon;
grant execute on function public.ensure_my_profile() to authenticated;

-- ---------------------------------------------------------------------------
-- Create an organization (onboarding). Creates the owner membership, settings and default business
-- categories in one transaction. MVP: one organization per owner.
-- ---------------------------------------------------------------------------
create or replace function public.create_organization(
  p_name text,
  p_registration_no text default null,
  p_address text default null,
  p_email text default null,
  p_phone text default null,
  p_website text default null
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_org uuid;
  names text[] := array['Marketing','Advertising','Office Supplies','Software','Subscriptions','Fuel','Travel','Equipment','Utilities','Maintenance','Supplier Purchases','Other'];
  icons text[] := array['megaphone','badge-percent','paperclip','laptop','repeat','fuel','plane','wrench','zap','hammer','boxes','circle-ellipsis'];
  i int;
begin
  if v_uid is null then raise exception 'not authenticated'; end if;
  if char_length(coalesce(trim(p_name), '')) = 0 then raise exception 'business name is required'; end if;
  if exists (select 1 from public.organization_members where user_id = v_uid and role = 'owner') then
    raise exception 'organization already exists' using errcode = 'unique_violation';
  end if;

  insert into public.organizations (name, registration_no, address, email, phone, website, created_by)
  values (trim(p_name), nullif(trim(p_registration_no), ''), nullif(trim(p_address), ''), nullif(trim(p_email), ''),
          nullif(trim(p_phone), ''), nullif(trim(p_website), ''), v_uid)
  returning id into v_org;

  insert into public.organization_members (organization_id, user_id, role) values (v_org, v_uid, 'owner');
  insert into public.organization_settings (organization_id) values (v_org);

  for i in 1 .. array_length(names, 1) loop
    insert into public.expense_categories (scope, organization_id, name, icon, sort_order, is_system)
    values ('business', v_org, names[i], icons[i], i, names[i] = 'Other');
  end loop;

  perform public.seed_user(v_uid, null);
  update public.user_preferences set active_organization_id = v_org where user_id = v_uid;
  insert into public.audit_logs (user_id, organization_id, action, entity, entity_id)
  values (v_uid, v_org, 'organization.create', 'organization', v_org);
  return v_org;
end $$;
revoke all on function public.create_organization(text, text, text, text, text, text) from public, anon;
grant execute on function public.create_organization(text, text, text, text, text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------------
alter table public.organizations enable row level security;
alter table public.organization_members enable row level security;
alter table public.organization_settings enable row level security;
alter table public.expense_categories enable row level security;
alter table public.expenses enable row level security;
alter table public.expense_items enable row level security;

-- Organizations are created only through create_organization(); there is no direct insert/delete.
create policy organizations_select on public.organizations
  for select to authenticated using (public.is_org_member(id));
create policy organizations_update on public.organizations
  for update to authenticated
  using (public.has_org_role(id, array['owner', 'admin']::public.org_role[]))
  with check (public.has_org_role(id, array['owner', 'admin']::public.org_role[]));

create policy org_members_select on public.organization_members
  for select to authenticated using (public.is_org_member(organization_id));

create policy org_settings_select on public.organization_settings
  for select to authenticated using (public.is_org_member(organization_id));
create policy org_settings_update on public.organization_settings
  for update to authenticated
  using (public.has_org_role(organization_id, array['owner', 'admin']::public.org_role[]))
  with check (public.has_org_role(organization_id, array['owner', 'admin']::public.org_role[]));

-- Categories: personal = own; business = members read, owner/admin manage.
create policy categories_select on public.expense_categories
  for select to authenticated using (
    (scope = 'personal' and user_id = auth.uid())
    or (scope = 'business' and public.is_org_member(organization_id))
  );
create policy categories_insert on public.expense_categories
  for insert to authenticated with check (
    (scope = 'personal' and user_id = auth.uid())
    or (scope = 'business' and public.has_org_role(organization_id, array['owner', 'admin']::public.org_role[]))
  );
create policy categories_update on public.expense_categories
  for update to authenticated
  using (
    (scope = 'personal' and user_id = auth.uid())
    or (scope = 'business' and public.has_org_role(organization_id, array['owner', 'admin']::public.org_role[]))
  )
  with check (
    (scope = 'personal' and user_id = auth.uid())
    or (scope = 'business' and public.has_org_role(organization_id, array['owner', 'admin']::public.org_role[]))
  );

-- Expenses. Personal expenses are visible ONLY to the user who owns them — never to organization members.
create policy expenses_select on public.expenses
  for select to authenticated using (
    (scope = 'personal' and user_id = auth.uid())
    or (scope = 'business' and public.is_org_member(organization_id))
  );
create policy expenses_insert on public.expenses
  for insert to authenticated with check (
    user_id = auth.uid()
    and (scope = 'personal' or public.is_org_member(organization_id))
    -- Foreign keys bypass RLS: referenced receipts/extractions must be the caller's own.
    and (receipt_file_id is null or exists (
      select 1 from public.receipt_files r where r.id = receipt_file_id and r.user_id = auth.uid()))
    and (ai_extraction_id is null or exists (
      select 1 from public.ai_extraction_results a where a.id = ai_extraction_id and a.user_id = auth.uid()))
  );
create policy expenses_update on public.expenses
  for update to authenticated
  using (
    (scope = 'personal' and user_id = auth.uid())
    or (scope = 'business' and public.is_org_member(organization_id))
  )
  with check (
    ((scope = 'personal' and user_id = auth.uid()) or (scope = 'business' and public.is_org_member(organization_id)))
    and (receipt_file_id is null or exists (
      select 1 from public.receipt_files r where r.id = receipt_file_id and r.user_id = expenses.user_id))
    and (ai_extraction_id is null or exists (
      select 1 from public.ai_extraction_results a where a.id = ai_extraction_id and a.user_id = expenses.user_id))
  );
-- Expenses are soft-deleted (deleted_at); no hard delete through the API.

create policy expense_items_select on public.expense_items
  for select to authenticated using (exists (select 1 from public.expenses e where e.id = expense_id));
create policy expense_items_insert on public.expense_items
  for insert to authenticated with check (
    exists (select 1 from public.expenses e where e.id = expense_id and e.user_id = auth.uid())
  );

drop policy if exists prefs_own on public.user_preferences;
create policy prefs_own on public.user_preferences
  for all to authenticated
  using (user_id = auth.uid())
  with check (
    user_id = auth.uid()
    and (last_organization_id is null or public.is_org_member(last_organization_id))
    and (active_organization_id is null or public.is_org_member(active_organization_id))
  );

-- Audit: users read their own entries and their organizations' entries; insert only as themselves.
drop policy if exists audit_select on public.audit_logs;
drop policy if exists audit_insert on public.audit_logs;
create policy audit_select on public.audit_logs
  for select to authenticated using (
    user_id = auth.uid() or (organization_id is not null and public.has_org_role(organization_id, array['owner', 'admin']::public.org_role[]))
  );
create policy audit_insert on public.audit_logs
  for insert to authenticated with check (
    user_id = auth.uid() and (organization_id is null or public.is_org_member(organization_id))
  );

-- ---------------------------------------------------------------------------
-- Storage: private bucket for organization assets (logo). Objects live under "<organization_id>/<file>".
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('org-assets', 'org-assets', false, 2097152, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update set public = false;

create or replace function public.storage_org_access(p_name text, p_manage boolean) returns boolean
language plpgsql stable security definer set search_path = public as $$
declare v_org uuid;
begin
  begin
    v_org := (string_to_array(p_name, '/'))[1]::uuid;
  exception when others then
    return false;
  end;
  if p_manage then
    return public.has_org_role(v_org, array['owner', 'admin']::public.org_role[]);
  end if;
  return public.is_org_member(v_org);
end $$;
revoke all on function public.storage_org_access(text, boolean) from public, anon;
grant execute on function public.storage_org_access(text, boolean) to authenticated;

create policy "org_assets_select" on storage.objects
  for select to authenticated using (bucket_id = 'org-assets' and public.storage_org_access(name, false));
create policy "org_assets_insert" on storage.objects
  for insert to authenticated with check (bucket_id = 'org-assets' and public.storage_org_access(name, true));
create policy "org_assets_update" on storage.objects
  for update to authenticated using (bucket_id = 'org-assets' and public.storage_org_access(name, true));
create policy "org_assets_delete" on storage.objects
  for delete to authenticated using (bucket_id = 'org-assets' and public.storage_org_access(name, true));

-- ---------------------------------------------------------------------------
-- Explicit Data API privileges (projects may have auto-expose turned off)
-- ---------------------------------------------------------------------------
grant select, update on public.organizations, public.organization_settings to authenticated;
grant select on public.organization_members to authenticated;
grant select, insert, update on public.expense_categories, public.expenses to authenticated;
grant select, insert on public.expense_items to authenticated;
grant all on public.organizations, public.organization_members, public.organization_settings,
  public.expense_categories, public.expenses, public.expense_items to service_role;
revoke all on public.organizations, public.organization_members, public.organization_settings,
  public.expense_categories, public.expenses, public.expense_items from anon;

-- Re-seed users that already exist (personal categories + preferences).
do $$
declare u record;
begin
  for u in select id from auth.users loop
    perform public.seed_user(u.id, null);
  end loop;
end $$;


-- ===== record migration history (so `supabase db push` / GitHub deploys skip these) =====
create schema if not exists supabase_migrations;
create table if not exists supabase_migrations.schema_migrations (version text primary key, statements text[], name text);
insert into supabase_migrations.schema_migrations (version, name) values
  ('20261114000001', 'init'),
  ('20261114000002', 'storage'),
  ('20261114000003', 'explicit_grants'),
  ('20261114000004', 'harden_functions'),
  ('20261119000005', 'organizations')
on conflict (version) do nothing;
