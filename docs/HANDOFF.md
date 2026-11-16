# KiraGo — handoff notes (start here)

Context for the next working session ("02 KiraGo Update"). No secrets in this file.

## Live
- App: **https://kiragolive.vercel.app** (old alias still works: application-testing-gamma.vercel.app)
- Code: GitHub `amirulhakim08/application_testing`, branch **`claude/pensive-brahmagupta-9lbznv`**
  (Vercel production branch; every push auto-deploys). There is no `main` branch yet.
- Vercel project: **application-testing** (team "amirul-hakim", Hobby). Functions region `sin1` (vercel.json).
  Deployment Protection must stay OFF for the production domain. Daily cron → `/api/cron/cleanup`.
  Duplicate project **application-testing-9sco** is unused — owner may delete it.
- Supabase (production): project **kirago-sg**, ref `fxgtvtlkxkplgobbbjat`, region ap-southeast-1 (Singapore), Free plan.
  Migrations 0001–0004 applied manually via SQL and recorded in `supabase_migrations.schema_migrations`.
  Auth URL config: Site URL `https://kiragolive.vercel.app`, redirect `https://kiragolive.vercel.app/**`.
- Old Supabase project (Sydney) ref `uuunkzpsquzivbfqdkfa` is the previous home; data was copied to kirago-sg on 2026-11-15
  (receipt *images* were not copied — 3 receipts show "image no longer stored"). Its GitHub integration still points at
  the old project. PAUSED on 2026-11-16 (its Vercel integration removed, GitHub deploy-to-production off). Owner may delete it
  after ~2026-11-23.
- Vercel env vars: NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY (publishable key), SUPABASE_SERVICE_ROLE_KEY,
  CRON_SECRET (set manually, Production only, on 2026-11-16). The Supabase↔Vercel integration on the OLD project kept
  overwriting these back to Sydney; it was disconnected on 2026-11-16 (GitHub integration on the old project too).
  Do NOT reconnect the integration. Verified via kirago-sg logs that the live app now talks to kirago-sg.
  No ANTHROPIC_API_KEY / OPENAI_API_KEY yet (receipts use free on-device OCR; voice uses typed/browser
  speech + free rule parser).

## Applying DB changes
Add a new file in `supabase/migrations/` AND apply it to kirago-sg (Supabase MCP `execute_sql`/SQL Editor), then insert
its version into `supabase_migrations.schema_migrations`. Regenerate `supabase/setup.sql` if needed. Run Security
Advisor afterwards (only expected warning: `ensure_my_workspaces` callable by authenticated — intentional).

## What exists
Next.js 16 (App Router, `src/proxy.ts`), React 19, Tailwind v4, shadcn-style UI, Recharts, Supabase (RLS everywhere,
private `receipts` bucket), Zod. EN + BM i18n (`src/lib/i18n`). PWA (`app/manifest.ts`, `public/sw.js`).
- Default category names are shown in BM when the language is BM (`src/lib/category-labels.ts`, display only; stored names stay English for voice/receipt matching).
- Money in integer sen (`src/lib/money.ts`); totals always derived from saved rows (`src/lib/aggregate.ts`).
- Periods (`src/lib/periods.ts`): This week/month cover the full calendar period (forward-dated expenses count);
  comparison is period-to-date; Reports average/day uses elapsed days.
- Capture: manual, voice (`src/lib/voice-parser.ts` rules → optional AI), receipt scan
  (`/api/receipts/scan` → AI if key, else free Tesseract OCR in browser: `src/lib/ocr/*`, assets copied to `public/ocr`
  by `scripts/copy-ocr-assets.mjs`). Receipt totals validated by `src/lib/receipt-total.ts`; duplicates warned.
- See README.md for full architecture, env vars and deployment.

## Testing
- `npm test` (Vitest, 76 tests), `npm run typecheck`, `npm run build`
- `npm run test:db` — migrations + RLS on throwaway Postgres
- `node e2e/smoke.mjs` — 17-step browser test against local app + local Supabase
  (`npx supabase start -x studio,logflare,vector,edge-runtime,imgproxy,supavisor,realtime,postgres-meta`;
  `.env.local` uses the local demo keys printed by `supabase start`). In cloud containers Docker may need `dockerd &`.
- The cloud session network cannot reach *.vercel.app; ask the owner to verify the live site.

## Owner preferences
- Communicates in Bahasa Melayu; non-technical — give step-by-step dashboard instructions with exact menu names.
- Wants free options where possible. Confirm before changing production data or creating cloud resources.

## Open ideas / not done
- Optional: AI keys for higher-accuracy receipts and real speech-to-text.
- Leaked Password Protection is off in Supabase Auth.
