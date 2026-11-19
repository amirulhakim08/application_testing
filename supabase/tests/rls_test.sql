-- RLS + integrity tests. Any failed assertion raises and aborts with a non-zero exit.
\set ON_ERROR_STOP on
set client_min_messages = warning;

-- A: owner of "Aina Bakery". B: owner of another business. C: staff of A's business (future feature, set up directly).
insert into auth.users (id, email, raw_user_meta_data) values
  ('11111111-1111-1111-1111-111111111111', 'a@example.com', '{"full_name":"Aina"}'),
  ('22222222-2222-2222-2222-222222222222', 'b@example.com', '{}'),
  ('33333333-3333-3333-3333-333333333333', 'c@example.com', '{}');

do $$ begin
  assert (select count(*) from public.profiles) = 3, 'profiles seeded';
  assert (select count(*) from public.expense_categories where scope = 'personal' and user_id = '11111111-1111-1111-1111-111111111111') = 10, '10 personal categories';
  assert (select count(*) from public.user_preferences) = 3, 'prefs seeded';
  assert (select language from public.user_preferences limit 1) = 'ms', 'Bahasa Melayu by default';
  assert (select count(*) from public.organizations) = 0, 'no business until onboarding';
end $$;

-- ---------------------------------------------------------------- user A
set role authenticated;
\o /dev/null
select set_config('request.jwt.claim.sub', '11111111-1111-1111-1111-111111111111', false);
select public.create_organization('Aina Bakery Sdn Bhd', '202601000123', 'Kajang', 'a@example.com', '012-3456789', null);
\o

do $$ begin
  assert (select count(*) from public.organizations) = 1, 'A sees own business';
  assert (select role from public.organization_members where user_id = auth.uid()) = 'owner', 'A is owner';
  assert (select invoice_prefix from public.organization_settings) = 'INV', 'settings created';
  assert (select count(*) from public.expense_categories where scope = 'business') = 12, '12 business categories';
  assert (select active_organization_id from public.user_preferences) = (select id from public.organizations), 'active org remembered';
end $$;

-- One business per owner in the MVP
do $$ begin
  begin
    perform public.create_organization('Second business');
    raise exception 'second organization accepted';
  exception when unique_violation then null;
  end;
end $$;

-- Owner can update business details and settings
update public.organizations set bank_name = 'Maybank', bank_account_no = '5123 4567 8901';
update public.organization_settings set default_tax_rate = 8.00;
do $$ begin
  assert (select bank_name from public.organizations) = 'Maybank', 'owner updates org';
  assert (select default_tax_rate from public.organization_settings) = 8.00, 'owner updates settings';
end $$;

insert into public.expenses (scope, user_id, category_id, amount, expense_date, entry_method)
select 'personal', auth.uid(), c.id, 85.00, current_date, 'voice'
from public.expense_categories c where c.scope = 'personal' and c.name = 'Groceries';

insert into public.expenses (scope, user_id, organization_id, category_id, amount, expense_date, entry_method, payment_method)
select 'business', auth.uid(), c.organization_id, c.id, 240.00, current_date, 'manual', 'online_banking'
from public.expense_categories c where c.scope = 'business' and c.name = 'Office Supplies';

do $$ begin
  assert (select sum(amount) from public.expenses where scope = 'personal') = 85.00, 'personal total';
  assert (select sum(amount) from public.expenses where scope = 'business') = 240.00, 'business total';
end $$;

-- A business category on a personal expense is rejected
do $$ begin
  begin
    insert into public.expenses (scope, user_id, category_id, amount, expense_date, entry_method)
    values ('personal', auth.uid(), (select id from public.expense_categories where scope = 'business' limit 1), 10, current_date, 'manual');
    raise exception 'cross-scope category accepted';
  exception when foreign_key_violation then null;
  end;
end $$;

-- Personal expense cannot carry an organization; business expense must have one
do $$ begin
  begin
    insert into public.expenses (scope, user_id, organization_id, amount, expense_date, entry_method)
    values ('personal', auth.uid(), (select id from public.organizations), 10, current_date, 'manual');
    raise exception 'personal expense with organization accepted';
  exception when check_violation then null;
  end;
  begin
    insert into public.expenses (scope, user_id, amount, expense_date, entry_method)
    values ('business', auth.uid(), 10, current_date, 'manual');
    raise exception 'business expense without organization accepted';
  exception when check_violation or insufficient_privilege then null;
  end;
end $$;

-- Amount must be positive
do $$ begin
  begin
    insert into public.expenses (scope, user_id, amount, expense_date, entry_method)
    values ('personal', auth.uid(), 0, current_date, 'manual');
    raise exception 'zero amount accepted';
  exception when check_violation then null;
  end;
end $$;

-- Category owner cannot be changed
do $$ begin
  begin
    update public.expense_categories set scope = 'personal', user_id = auth.uid(), organization_id = null where scope = 'business' and name = 'Fuel';
    raise exception 'category moved between scopes';
  exception when check_violation then null;
  end;
end $$;

-- Storage: own receipt folder ok, foreign folder rejected; org assets only under own organization
insert into storage.objects (bucket_id, name) values ('receipts', '11111111-1111-1111-1111-111111111111/a.webp');
do $$ begin
  begin
    insert into storage.objects (bucket_id, name) values ('receipts', '22222222-2222-2222-2222-222222222222/x.webp');
    raise exception 'foreign receipt path accepted';
  exception when insufficient_privilege then null;
  end;
end $$;
do $$
declare v_path text := (select id::text from public.organizations) || '/logo.png';
begin
  insert into storage.objects (bucket_id, name) values ('org-assets', v_path);
  begin
    insert into storage.objects (bucket_id, name) values ('org-assets', 'not-a-uuid/logo.png');
    raise exception 'invalid org asset path accepted';
  exception when insufficient_privilege then null;
  end;
end $$;

insert into public.receipt_files (id, user_id, storage_path, mime_type, size_bytes, sha256)
values ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', auth.uid(), '11111111-1111-1111-1111-111111111111/a.webp', 'image/webp', 1000, repeat('a', 64));

-- Move business expense to personal (category moves too): totals follow
update public.expenses set scope = 'personal', organization_id = null,
  category_id = (select id from public.expense_categories where scope = 'personal' and name = 'Other')
where amount = 240.00;
do $$ begin
  assert (select sum(amount) from public.expenses where scope = 'personal') = 325.00, 'moved to personal';
  assert (select coalesce(sum(amount), 0) from public.expenses where scope = 'business') = 0, 'business now zero';
end $$;
-- ...and back to business
update public.expenses set scope = 'business', organization_id = (select id from public.organizations),
  category_id = (select id from public.expense_categories where scope = 'business' and name = 'Office Supplies')
where amount = 240.00;

reset role;
-- C becomes STAFF of A's business (staff invitations are a future feature)
insert into public.organization_members (organization_id, user_id, role)
select id, '33333333-3333-3333-3333-333333333333', 'staff' from public.organizations where created_by = '11111111-1111-1111-1111-111111111111';

-- ---------------------------------------------------------------- staff C
set role authenticated;
\o /dev/null
select set_config('request.jwt.claim.sub', '33333333-3333-3333-3333-333333333333', false);
\o
do $$ begin
  assert (select count(*) from public.organizations) = 1, 'C sees A business';
  assert (select count(*) from public.expenses where scope = 'business') = 1, 'C sees business expense';
  assert (select count(*) from public.expenses where scope = 'personal') = 0, 'C must NOT see A personal expenses';
  assert (select count(*) from public.expense_categories where scope = 'personal') = 10, 'C sees only own personal categories';
  assert (select count(*) from public.receipt_files) = 0, 'C cannot read A receipt files';
end $$;
-- Staff cannot change business details, settings or categories
update public.organizations set name = 'Hacked';
update public.organization_settings set invoice_prefix = 'HACK';
do $$ begin
  begin
    insert into public.expense_categories (scope, organization_id, name)
    values ('business', (select id from public.organizations), 'Staff category');
    raise exception 'staff created business category';
  exception when insufficient_privilege then null;
  end;
end $$;
reset role;
do $$ begin
  assert (select name from public.organizations where created_by = '11111111-1111-1111-1111-111111111111') = 'Aina Bakery Sdn Bhd', 'staff cannot rename org';
  assert (select invoice_prefix from public.organization_settings s join public.organizations o on o.id = s.organization_id
          where o.created_by = '11111111-1111-1111-1111-111111111111') = 'INV', 'staff cannot change settings';
end $$;

-- Remember A's organization id for the cross-tenant attempts below
\o /dev/null
select set_config('test.org_a', (select id::text from public.organizations where created_by = '11111111-1111-1111-1111-111111111111'), false);
\o

-- ---------------------------------------------------------------- user B (another business)
set role authenticated;
\o /dev/null
select set_config('request.jwt.claim.sub', '22222222-2222-2222-2222-222222222222', false);
select public.create_organization('Bistro B');
\o
do $$ begin
  assert (select count(*) from public.organizations) = 1, 'B sees only own business';
  assert (select name from public.organizations) = 'Bistro B', 'B business';
  assert (select count(*) from public.organization_members) = 1, 'B sees only own members';
  assert (select count(*) from public.organization_settings) = 1, 'B sees only own settings';
  assert (select count(*) from public.expenses) = 0, 'B cannot read A expenses';
  assert (select count(*) from public.expense_categories) = 22, 'B sees only own categories (10 + 12)';
  assert (select count(*) from public.receipt_files) = 0, 'B cannot read A receipts';
  assert (select count(*) from storage.objects) = 0, 'B cannot list A storage objects';
  assert (select count(*) from public.audit_logs where organization_id is not null and user_id <> auth.uid()) = 0, 'B cannot read A audit';
end $$;

-- B cannot write a business expense into A's organization
do $$ begin
  begin
    insert into public.expenses (scope, user_id, organization_id, amount, expense_date, entry_method)
    values ('business', auth.uid(), current_setting('test.org_a')::uuid, 1, current_date, 'manual');
    raise exception 'B wrote into A business';
  exception when insufficient_privilege then null;
  end;
  begin
    insert into storage.objects (bucket_id, name) values ('org-assets', current_setting('test.org_a') || '/logo.png');
    raise exception 'B uploaded into A org folder';
  exception when insufficient_privilege then null;
  end;
end $$;

-- B cannot write as A, cannot attach A's receipt, cannot upload into A's org folder
do $$ begin
  begin
    insert into public.expenses (scope, user_id, amount, expense_date, entry_method)
    values ('personal', '11111111-1111-1111-1111-111111111111', 1, current_date, 'manual');
    raise exception 'B wrote as A';
  exception when insufficient_privilege then null;
  end;
  begin
    insert into public.expenses (scope, user_id, amount, expense_date, entry_method, receipt_file_id)
    values ('personal', auth.uid(), 1, current_date, 'manual', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa');
    raise exception 'B attached A receipt';
  exception when insufficient_privilege then null;
  end;
end $$;

-- B cannot point preferences at A's organization
do $$ begin
  begin
    update public.user_preferences set active_organization_id = current_setting('test.org_a')::uuid;
    raise exception 'B set A org as active';
  exception when insufficient_privilege then null;
  end;
end $$;

-- B's update/delete of A's rows affects nothing
update public.expenses set amount = 1;
update public.organizations set name = 'Hacked' where name <> 'Bistro B';
delete from public.expenses;
reset role;
do $$ begin
  assert (select count(*) from public.expenses where user_id = '11111111-1111-1111-1111-111111111111') = 2, 'A rows intact';
  assert (select sum(amount) from public.expenses) = 325.00, 'A amounts intact';
  assert (select count(*) from public.organizations where name = 'Hacked') = 0, 'org names intact';
end $$;

-- Anonymous: no access at all
set role anon;
do $$ begin
  begin
    perform count(*) from public.expenses;
    raise exception 'anon read expenses';
  exception when insufficient_privilege then null;
  end;
  begin
    perform count(*) from public.organizations;
    raise exception 'anon read organizations';
  exception when insufficient_privilege then null;
  end;
end $$;
reset role;

select 'ALL RLS TESTS PASSED' as result;
