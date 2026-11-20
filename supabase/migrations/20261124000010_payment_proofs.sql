-- BukuTigaLima: optional proof of payment (bank/DuitNow screenshot, PDF) for any recorded payment, including direct
-- sale receipts. Files live in the private "payment-proofs" bucket under "<organization_id>/<payment_id>/<file>".
-- The browser uploads the file after the payment is recorded, then attach_payment_proof() links it (once).

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('payment-proofs', 'payment-proofs', false, 5242880, array['image/jpeg', 'image/png', 'image/webp', 'application/pdf'])
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

alter table public.payments add column proof_path text check (char_length(proof_path) <= 300);

-- Upload rule: a member of the business, into the folder of one of its payments that has no proof yet.
create or replace function public.storage_payment_proof_ok(p_name text) returns boolean
language plpgsql stable security definer set search_path = public as $$
declare v_parts text[] := string_to_array(p_name, '/'); v_org uuid; v_pay uuid;
begin
  if array_length(v_parts, 1) <> 3 or v_parts[3] = '' or p_name like '%..%' then return false; end if;
  begin
    v_org := v_parts[1]::uuid; v_pay := v_parts[2]::uuid;
  exception when others then return false;
  end;
  return public.is_org_member(v_org)
    and exists (select 1 from public.payments where id = v_pay and organization_id = v_org and proof_path is null);
end $$;
revoke all on function public.storage_payment_proof_ok(text) from public, anon;
grant execute on function public.storage_payment_proof_ok(text) to authenticated;

create policy "payment_proofs_select" on storage.objects
  for select to authenticated using (bucket_id = 'payment-proofs' and public.storage_org_access(name, false));
create policy "payment_proofs_insert" on storage.objects
  for insert to authenticated with check (bucket_id = 'payment-proofs' and public.storage_payment_proof_ok(name));
create policy "payment_proofs_delete" on storage.objects
  for delete to authenticated using (bucket_id = 'payment-proofs' and public.storage_org_access(name, true));

-- Links an uploaded file to its payment. Only once: a proof is part of the payment record.
create or replace function public.attach_payment_proof(p_payment_id uuid, p_path text) returns void
language plpgsql security definer set search_path = public as $$
declare pay record;
begin
  select * into pay from public.payments where id = p_payment_id for update;
  if not found then raise exception 'payment not found' using errcode = 'no_data_found'; end if;
  perform public.require_member(pay.organization_id);
  if pay.proof_path is not null then
    if pay.proof_path = p_path then return; end if;
    raise exception 'this payment already has a proof' using errcode = 'check_violation';
  end if;
  if p_path is null or p_path not like pay.organization_id || '/' || pay.id || '/%' or p_path like '%..%'
     or char_length(p_path) > 300 then
    raise exception 'invalid proof path' using errcode = 'check_violation';
  end if;
  update public.payments set proof_path = p_path where id = p_payment_id;
  insert into public.audit_logs (user_id, organization_id, action, entity, entity_id, metadata)
  values (auth.uid(), pay.organization_id, 'payment.proof', 'payment', p_payment_id, jsonb_build_object('path', p_path));
end $$;
revoke all on function public.attach_payment_proof(uuid, text) from public, anon;
grant execute on function public.attach_payment_proof(uuid, text) to authenticated;
