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

-- ===== 20261120000006_sales.sql =====
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

-- ===== 20261121000007_delivery_orders.sql =====
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

-- ===== 20261122000008_daily_numbers_cash_sales.sql =====
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
