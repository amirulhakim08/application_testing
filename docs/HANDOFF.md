# BukuTigaLima (formerly KiraGo) — handoff notes (start here)

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
  Migration 0005 (BukuTigaLima foundation) applied to kirago-sg on 2026-11-19 with the owner's OK (KiraGo test data reset).
  Migration 0006 (sales) applied to kirago-sg on 2026-11-19 with the owner's OK (additive only). Advisor: only the
  intended SECURITY DEFINER entry points (each checks membership) + waktusolat findings + leaked-password (Pro plan).
  NOTE: kirago-sg is SHARED with another app of the owner ("Waktu Solat", schema `waktusolat`, buckets
  `waktusolat-*`, its own triggers on auth.users, migrations named waktusolat_*). Both apps share auth.users. Never
  modify the `waktusolat` schema; keep BukuTigaLima objects in `public` and avoid name clashes. Its advisor
  warnings are not ours.
  Auth URL config: Site URL `https://kiragolive.vercel.app`, redirect `https://kiragolive.vercel.app/**`.
- Old Supabase project (Sydney) ref `uuunkzpsquzivbfqdkfa` was DELETED on 2026-11-16 (it only held test data). kirago-sg is
  the only Supabase project. Do not connect the Supabase↔Vercel or Supabase↔GitHub integrations; apply DB changes manually.
- Vercel env vars: NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY (publishable key), SUPABASE_SERVICE_ROLE_KEY,
  CRON_SECRET (set manually, Production only, on 2026-11-16). The Supabase↔Vercel integration on the OLD project kept
  overwriting these back to Sydney; it was disconnected on 2026-11-16 (GitHub integration on the old project too).
  Do NOT reconnect the integration. Verified via kirago-sg logs that the live app now talks to kirago-sg.
  No ANTHROPIC_API_KEY / OPENAI_API_KEY yet (receipts use free on-device OCR; voice uses typed/browser
  speech + free rule parser).

## Applying DB changes
Add a new file in `supabase/migrations/` AND apply it to kirago-sg (Supabase MCP `execute_sql`/SQL Editor), then insert
its version into `supabase_migrations.schema_migrations`. Regenerate `supabase/setup.sql` if needed. Run Security
Advisor afterwards (expected warnings: `ensure_my_profile`, `create_organization`, `is_org_member`, `has_org_role`,
`storage_org_access` and the sales write functions callable by authenticated — intentional; each checks auth.uid()
membership).

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
- `npm test` (Vitest, 93 tests), `npm run typecheck`, `npm run build`
- `npm run test:db` — migrations + RLS + sales tests + concurrent numbering on throwaway Postgres
- `node e2e/sales.mjs` — sales flow (quotation → invoice → partial payments → outstanding, isolation)
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

## BukuTigaLima rebuild (in progress)
Owner's spec: "BukuTigaLima Master Development Prompt V4". Decisions (2026-11-19): keep this repo/Vercel/kirago-sg and
rename; clear KiraGo test data; app URL bukutigalima.vercel.app; email provider later (Resend + domain); no "Lihat Demo";
tax = per item from catalog + configurable SST rate + extra charges (e.g. service charge); simple logo by us.
Develop and test locally first (local Supabase via Docker + `npm run test:db` + `node e2e/smoke.mjs`), then apply to
kirago-sg with the owner's OK. The owner's other Supabase project "mydevelopment" is NOT ours — never touch it.

- Phase 1 (foundation) done in code: migration 0005 (organizations, members, settings, expense scopes, org-assets bucket,
  create_organization RPC, ensure_my_profile replaces ensure_my_workspaces), onboarding wizard (/onboarding), new
  sidebar/drawer shell, branding (navy #17324D / copper #B77945), settings for business/bank/documents/password.
  Tests: 80 unit, RLS suite, 18/18 e2e steps against local Supabase.
- Phase 2 (sales) done in code: migration 0006 (customers, products, quotations, invoices, payments, receipts,
  document_sequences, invoice_balances view, write RPCs), pages /customers /products /quotations /invoices /payments
  /receipts /outstanding, WhatsApp reminder. Tests: 93 unit, RLS + sales SQL suites + 25-way concurrent numbering,
  e2e smoke 18/18 + e2e/sales.mjs 12/12.
- Phase 3 (documents) done in code: migration 0007 (delivery_orders + items, RPCs save/create_from/issue/
  mark_delivered/cancel; number DO-YYYY-NNNN given on issue), PDF engine with @react-pdf/renderer
  (src/lib/pdf/*: 3 templates classic/modern/navy, bilingual labels, amount in words, DRAF/BATAL watermark, logo from
  org-assets), route GET /api/documents/{quotation|invoice|receipt|delivery-order}/{id}/pdf?template=&download=1
  (receipt id = payment id; org-scoped, 404 otherwise). Pages /delivery-orders (list/new/[id]/edit); PDF/print buttons
  on quotation, invoice, receipt and payment lists. PDFs use built-in WinAnsi fonts: keep text Latin (use "-" not "−").
  Tests: 98 unit, RLS + sales + delivery SQL suites, smoke 18/18, sales 14/14.
- Owner request after Phase 3: migration 0008 — (1) daily document numbers for ALL types: PREFIX-YYMMDDNNN
  (e.g. INV-261023001; restarts at 001 per day; 4+ digits after 999, never wraps; old PREFIX-YYYY-NNNN numbers stay;
  document_sequences now has id PK + seq_date, legacy yearly rows have seq_date null); (2) direct sale receipts:
  cash_sales + cash_sale_items, RPC record_cash_sale(org, payload, request_key) prices items like invoices, records a
  standalone payment + receipt via record_payment, no invoice; immutable (void the payment to correct). Pages
  /receipts/new (DocumentEditor kind="sale") and /receipts/[id] (id = payment id); itemised receipt PDF.
  (3) Day/night toggle (ThemeToggle) in sidebar + mobile header; saves preference.
  Code tolerates 0008 not yet applied (cash_sales looked up separately; direct sale shows a save error until then).
- Migration 0009 (manual customer): editors use CustomerPicker (search by name/phone, "Add new customer" inline card with name, phone, address; walk-in on sale receipts). Typed details are either saved
  as a new customer (default, server action inserts into customers first) or stored only on the document as
  customer_snapshot with customer_id null (payload customer_manual, sanitised by manual_party()). Status change,
  convert, duplicate, issue (invoice/DO), create DO and record_cash_sale accept a snapshot instead of customer_id.
  Before 0009 is applied, unsaved typed details are silently dropped (document saves without customer).
- Migration 0010 (payment proofs): optional proof of payment on direct sale receipts and on Record payment.
  Private bucket "payment-proofs" (5 MB; jpg/png/webp/pdf), path "<org>/<payment>/<file>"; upload allowed only into
  a payment of the user's business that has no proof yet (storage_payment_proof_ok); attach_payment_proof() links it
  once (payments.proof_path). Images are read on-device (tesseract + src/lib/ocr/parse-payment-proof.ts) to suggest
  amount/date/reference. View via /api/payments/<id>/proof (signed URL, 120 s). Code tolerates 0010 not applied.
- In-app PDF view /documents/<kind>/<id> (pdf.js renders on device; worker copied to public/pdfjs by
  scripts/copy-ocr-assets.mjs): Back, template, Share (Web Share API with the PDF file; WhatsApp/Files/Print on
  phones) or Print (desktop), Download. PDF buttons open this page instead of a new tab.
- Migration 0011 (fix receipts): record_cash_sale payload.replaces_payment_id voids the old direct sale receipt when
  the corrected one is issued ("Betulkan resit", /receipts/new?replace=<payment>); delete_payment_receipt() lets
  owner/admin permanently delete a receipt + payment within 24 h (audit log keeps it; number not reused; proof file
  removed by the action). Show/hide password toggle (PasswordInput); auth errors translated.
- Next: Phase 4 (expense refinements), 5 (business dashboard/reports), 6 (landing), 7 (security review).
