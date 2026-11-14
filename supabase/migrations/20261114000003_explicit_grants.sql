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
