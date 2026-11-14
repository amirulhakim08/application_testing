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
