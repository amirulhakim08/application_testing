-- Security Advisor fixes:
-- 1) pin search_path on trigger helper functions
-- 2) trigger-only SECURITY DEFINER function must not be callable through the API
-- (ensure_my_workspaces stays callable by signed-in users on purpose: it only seeds the caller's own data.)
alter function public.touch_updated_at() set search_path = public;
alter function public.forbid_user_change() set search_path = public;
revoke all on function public.handle_new_user() from public, anon, authenticated;
