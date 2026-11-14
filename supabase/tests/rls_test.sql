-- RLS + integrity tests. Any failed assertion raises and aborts with a non-zero exit.
\set ON_ERROR_STOP on
set client_min_messages = warning;

insert into auth.users (id, email, raw_user_meta_data) values
  ('11111111-1111-1111-1111-111111111111', 'a@example.com', '{"full_name":"Aina","company_name":"Aina Bakery Sdn Bhd"}'),
  ('22222222-2222-2222-2222-222222222222', 'b@example.com', '{}');

-- Onboarding created 2 workspaces, 24 categories, prefs for each user
do $$ begin
  assert (select count(*) from public.workspaces where owner_id = '11111111-1111-1111-1111-111111111111') = 2, 'two workspaces';
  assert (select name from public.workspaces where owner_id = '11111111-1111-1111-1111-111111111111' and kind='company') = 'Aina Bakery Sdn Bhd', 'company name from metadata';
  assert (select name from public.workspaces where owner_id = '22222222-2222-2222-2222-222222222222' and kind='company') = 'Company', 'default company name';
  assert (select count(*) from public.expense_categories where user_id = '11111111-1111-1111-1111-111111111111') = 24, '11 + 13 categories';
  assert (select count(*) from public.user_preferences) = 2, 'prefs';
end $$;

-- Act as user A
set role authenticated;
\o /dev/null
select set_config('request.jwt.claim.sub', '11111111-1111-1111-1111-111111111111', false);
\o

insert into public.expenses (user_id, workspace_id, category_id, amount, expense_date, entry_method)
select auth.uid(), w.id, c.id, 85.00, current_date, 'voice'
from public.workspaces w join public.expense_categories c on c.workspace_id = w.id
where w.kind = 'personal' and c.name = 'Groceries';

insert into public.expenses (user_id, workspace_id, category_id, amount, expense_date, entry_method)
select auth.uid(), w.id, c.id, 240.00, current_date, 'manual'
from public.workspaces w join public.expense_categories c on c.workspace_id = w.id
where w.kind = 'company' and c.name = 'Packaging';

do $$ begin
  assert (select count(*) from public.workspaces) = 2, 'A sees only own workspaces';
  assert (select sum(amount) from public.expenses e join public.workspaces w on w.id = e.workspace_id where w.kind='personal') = 85.00, 'personal total';
  assert (select sum(amount) from public.expenses e join public.workspaces w on w.id = e.workspace_id where w.kind='company') = 240.00, 'company total';
end $$;

-- Category from the other workspace must be rejected (composite FK)
do $$ begin
  begin
    insert into public.expenses (user_id, workspace_id, category_id, amount, expense_date, entry_method)
    select auth.uid(), (select id from public.workspaces where kind='personal'),
           (select c.id from public.expense_categories c join public.workspaces w on w.id=c.workspace_id where w.kind='company' limit 1),
           10, current_date, 'manual';
    raise exception 'cross-workspace category accepted';
  exception when foreign_key_violation then null;
  end;
end $$;

-- Amount must be positive
do $$ begin
  begin
    insert into public.expenses (user_id, workspace_id, amount, expense_date, entry_method)
    values (auth.uid(), (select id from public.workspaces where kind='personal'), 0, current_date, 'manual');
    raise exception 'zero amount accepted';
  exception when check_violation then null;
  end;
end $$;

-- Move company expense to personal (category must move too): totals follow
update public.expenses set workspace_id = (select id from public.workspaces where kind='personal'),
  category_id = (select c.id from public.expense_categories c join public.workspaces w on w.id=c.workspace_id where w.kind='personal' and c.name='Other')
where amount = 240.00;
do $$ begin
  assert (select sum(amount) from public.expenses e join public.workspaces w on w.id = e.workspace_id where w.kind='personal') = 325.00, 'moved to personal';
  assert (select coalesce(sum(amount),0) from public.expenses e join public.workspaces w on w.id = e.workspace_id where w.kind='company') = 0, 'company now zero';
end $$;

-- Own storage path allowed, foreign path rejected
insert into storage.objects (bucket_id, name) values ('receipts', '11111111-1111-1111-1111-111111111111/a.webp');
do $$ begin
  begin
    insert into storage.objects (bucket_id, name) values ('receipts', '22222222-2222-2222-2222-222222222222/x.webp');
    raise exception 'foreign storage path accepted';
  exception when insufficient_privilege then null;
  end;
end $$;

-- Receipt file for later cross-user test
insert into public.receipt_files (id, user_id, storage_path, mime_type, size_bytes, sha256)
values ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', auth.uid(), '11111111-1111-1111-1111-111111111111/a.webp', 'image/webp', 1000, repeat('a', 64));

-- Act as user B
\o /dev/null
select set_config('request.jwt.claim.sub', '22222222-2222-2222-2222-222222222222', false);
\o
do $$ begin
  assert (select count(*) from public.expenses) = 0, 'B cannot read A expenses';
  assert (select count(*) from public.workspaces) = 2, 'B sees only own workspaces';
  assert (select count(*) from public.receipt_files) = 0, 'B cannot read A receipts';
  assert (select count(*) from storage.objects) = 0, 'B cannot list A storage objects';
end $$;

-- B cannot write into A's workspace
do $$ begin
  begin
    insert into public.expenses (user_id, workspace_id, amount, expense_date, entry_method)
    values ('11111111-1111-1111-1111-111111111111',
            (select id from public.workspaces where owner_id = '11111111-1111-1111-1111-111111111111' limit 1), 1, current_date, 'manual');
    raise exception 'B wrote as A';
  exception when insufficient_privilege then null;
  end;
end $$;

-- B cannot attach A's receipt file to own expense
do $$ begin
  begin
    insert into public.expenses (user_id, workspace_id, amount, expense_date, entry_method, receipt_file_id)
    values (auth.uid(), (select id from public.workspaces where kind='personal'), 1, current_date, 'manual', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa');
    raise exception 'B attached A receipt';
  exception when insufficient_privilege then null;
  end;
end $$;

-- B's update/delete of A's rows affects nothing
update public.expenses set amount = 1;
delete from public.expenses;
reset role;
do $$ begin
  assert (select count(*) from public.expenses where user_id = '11111111-1111-1111-1111-111111111111') = 2, 'A rows intact';
  assert (select sum(amount) from public.expenses) = 325.00, 'A amounts intact';
end $$;

-- Anonymous: no access at all
set role anon;
do $$ begin
  begin
    perform count(*) from public.expenses;
    raise exception 'anon read expenses';
  exception when insufficient_privilege then null;
  end;
end $$;
reset role;

select 'ALL RLS TESTS PASSED' as result;
