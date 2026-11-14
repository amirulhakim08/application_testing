# Supabase for KiraGo

- `migrations/` — the database schema. With the Supabase GitHub integration
  ("Deploy to production" on this branch) these are applied automatically on every push.
- `setup.sql` — the same migrations in one file, only for projects **without** the GitHub
  integration. It also records the migration history, so a later GitHub deploy won't re-run them.
- `tests/` — RLS/integrity tests used by `npm run test:db`.
- `config.toml` — local development settings (`npx supabase start`). The GitHub production deploy
  ignores its auth/API settings.
