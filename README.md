# BukuTigaLima — Dulu Buku, Sekarang Digital.

**Live app:** https://bukutigalima.vercel.app (old alias: https://kiragolive.vercel.app)

BukuTigaLima is a responsive web app / PWA for Malaysian small businesses, freelancers and micro-SMEs. It combines
**business documents** (quotations, invoices, delivery orders, receipts, payments, outstanding invoices) with
**KiraGo**, a built-in daily expense module (receipt OCR, voice and manual entry) — under one login. Bahasa Melayu is the
default language; English is available. Currency MYR, timezone Asia/Kuala_Lumpur.

> Documents produced by BukuTigaLima are standard PDFs. They are **not** LHDN-validated e-Invoices and do not replace any
> tax or statutory obligation of the business.

### Delivery status

| Phase | Scope | Status |
|---|---|---|
| 1. Foundation | Rebrand, organizations + members, onboarding wizard, Personal/Business expense scopes, RLS, settings (business, bank, documents, password) | ✅ Done |
| 2. Business modules | Customers, products & services, quotations, invoices, conversion, payments, outstanding | ⏳ Next |
| 3. Documents | PDF templates, delivery orders, receipts, print | ⏳ |
| 4. KiraGo | Expense module on the new scopes (OCR, manual, duplicates) | ✅ carried over from KiraGo; refinements pending |
| 5. Voice & dashboards | Business dashboard, reports, cash movement | ⏳ (voice + expense dashboard already work) |
| 6. UX & PWA | Landing page, accessibility pass | ⏳ |
| 7. Security & deployment | Full review, deployment verification | ⏳ |

### Data model (Phase 1)

* **Organizations** (`organizations`, `organization_members` with role owner/admin/staff, `organization_settings` for
  template, document prefixes, payment terms, quotation validity and default tax). Created only through the
  `create_organization()` RPC in onboarding (one business per owner in the MVP). Logos live in the private `org-assets`
  bucket under `<organization_id>/…` and are served through short-lived signed URLs.
* **Expenses have an explicit scope.** `scope = 'personal'` → belongs to one user (`user_id`), never visible to other
  members of a business. `scope = 'business'` → belongs to `organization_id` and is visible to its members. Enforced by
  CHECK constraints, a category-ownership trigger and RLS (see `supabase/tests/rls_test.sql`, which includes a staff
  member who must not see the owner's personal expenses and a second business that must see nothing).
* In the UI the two expense "books" keep KiraGo's workspace vocabulary: the personal book id is the user id, the business
  book id is the organization id (`bookColumns()` in `src/lib/data.ts`).

The KiraGo sections below still describe the expense module accurately unless noted.

## Architecture

```
Browser (Next.js App Router, React 19, Tailwind v4, shadcn-style UI, Recharts)
   │  Server Components read data · Server Actions write data · Route Handlers for uploads/AI
   ▼
Next.js server (Node runtime)
   ├─ src/proxy.ts                session refresh + auth gate (Next 16 "proxy")
   ├─ src/app/actions/*           validated mutations (Zod) → Supabase with the user's JWT (RLS applies)
   ├─ src/app/api/receipts/scan   validate → sharp normalise → SHA-256 fingerprint → private storage → AI → checks
   ├─ src/app/api/voice/*         transcription (audio never stored) + interpretation (rules first, AI when unsure)
   ├─ src/lib/ai/*                provider interfaces + Anthropic (vision/text) + OpenAI (speech-to-text)
   └─ src/lib/*                   pure, unit-tested logic: money, dates, periods, aggregation,
                                  voice parser, receipt-total resolver, duplicates, CSV
   ▼
Supabase: Postgres (RLS on every table) · Auth (email/password, verification, reset) · Storage (private "receipts" bucket)
```

Key design decisions:

* **Money is exact.** The database stores amounts as `numeric(14,2)` and reads them as text (`amount::text`). TypeScript does all arithmetic in integer sen (`src/lib/money.ts`). There is no floating-point money anywhere.
* **Totals are always derived.** Dashboard and report numbers are computed from saved, non-deleted rows on every request. No running totals or balances are stored. AI suggestions don't touch totals until the user confirms and saves.
* **Personal and Business are strictly separate.** A trigger ensures an expense's category has the same scope and owner as the expense. Moving an expense between Personal and Business remaps its category (same name, or *Other*).
* **AI output is untrusted.** Model output is constrained by a schema, re-validated with Zod, and then sanitised (`src/lib/receipt-sanitize.ts`, `src/lib/voice-merge.ts`). Categories are limited to the user's own list. Prompts tell the model to ignore any instructions printed on receipts or spoken in transcripts.
* **The final receipt total is checked by code, not just by the model.** `src/lib/receipt-total.ts` cross-checks the total the AI picked against two things:
  * cash tendered minus change
  * subtotal + tax + service charge − discount ± rounding

  It flags cases where the model chose CASH, CHANGE or a tax line. When more than one total is plausible it asks the user to choose. It never invents a value when no total was found.
* **Cost control:**
  * Voice uses a free bilingual rule parser first (`src/lib/voice-parser.ts`) and calls the AI only when that parser is unsure (`VOICE_PARSER=auto`).
  * Scanning an identical image again reuses the earlier extraction and makes no new AI call.
  * Paid AI calls have per-user hourly limits.
  * Usage is recorded in `ai_usage_events` (metadata only: no images, audio, transcripts or amounts).

## Database

Migrations are in `supabase/migrations/`.

| Table | Purpose |
|---|---|
| `profiles` | Display name |
| `organizations`, `organization_members`, `organization_settings` | The business, its members (owner/admin/staff) and document preferences. Replaced KiraGo's `workspaces` in migration 0005. |
| `expense_categories` | Per-workspace categories (create / rename / archive) |
| `expenses` | Each expense: UUID, user, workspace, category, `numeric` amount, currency, merchant, description, date/time, entry method (`receipt_scan`, `voice`, `manual`), receipt reference, timestamps, soft delete |
| `expense_items` | Optional receipt line items |
| `receipt_files` | Private storage path + SHA-256 fingerprint. The fingerprint is kept after the image is deleted, so duplicate detection still works. |
| `ai_extraction_results` | Sanitised AI output, confidence, review flag |
| `user_preferences` | Language, theme, currency, receipt retention, last workspace/category |
| `audit_logs` | Create/update/delete events (ids only, no financial content) |
| `ai_usage_events` | AI usage monitoring and rate limiting |

* A trigger on `auth.users` sets up each new account automatically: profile, preferences (language from the sign-up screen, BM by default) and personal categories. The business, its settings and business categories are created in the onboarding wizard.
* RLS is on for every table. Policies also check that any receipt or extraction referenced by an expense belongs to the same user (foreign keys bypass RLS).
* The storage bucket `receipts` is private. Objects live under `<user_id>/…` and are viewed only through signed URLs that expire after 5 minutes.

## Screens

* **Dashboard:**
  * Personal and Company cards, each showing the total, today's spend, the transaction count and the change against the previous equivalent period
  * Period filters: Today, This week, This month (default), Last month, Custom
  * Quick-add buttons for Scan, Voice and Manual
  * Recent transactions, category breakdown and a 6-month trend
* **Expenses:**
  * List grouped by date, with daily totals
  * Search across merchant, description and notes
  * Filters for workspace, category, date range and amount range
  * CSV export and receipt preview
  * Edit and delete (delete asks for confirmation)
* **Add:**
  * **Scan:** camera or upload, AI review screen with confidence highlights, ambiguity picker, confirmation checkbox for uncertain amounts, and a duplicate warning
  * **Voice:** record, then transcribe, then edit the transcript, then interpret. Shows proposals for several expenses at once, with a typed fallback.
  * **Manual:** amount first, remembered workspace/category, optional receipt attachment
* **Reports:** Personal and Company totals, average per day, top category, daily/weekly/monthly trend, category distribution, and a 12-month comparison. Can show combined, Personal only or Company only.
* **Categories, Settings:** profile, company name, language (English / Bahasa Melayu), theme, currency, receipt retention, AI usage, CSV and JSON export, deletion of all receipts, account deletion, logout.
* **Navigation:** mobile uses a bottom bar (Home, Expenses, ＋, Reports, Settings) where ＋ opens a bottom sheet with the three capture methods. Desktop uses a sidebar.

## Setup

Requirements: Node 20+ (tested on Node 22), a Supabase project (or the Supabase CLI with Docker for local development).

```bash
npm install
cp .env.example .env.local    # fill in values, see below
```

### Supabase

**Hosted:**
1. Create a project.
2. Open the SQL Editor and run `supabase/setup.sql` (all migrations combined), or use `supabase link` then `supabase db push`.
3. In **Auth → URL configuration**, set the Site URL and add `https://YOUR-DOMAIN/auth/confirm` as a redirect URL.
4. Keep **Confirm email** enabled.

**Local:**
```bash
npx supabase start   # applies migrations; prints the URL/anon/service keys
```

### Environment variables

| Variable | Required | Notes |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` | yes | Public. RLS protects the data. |
| `SUPABASE_SERVICE_ROLE_KEY` | for account deletion & retention job | Server-only. Never exposed to the browser. |
| `NEXT_PUBLIC_SITE_URL` | yes | Used in email links |
| `AI_VISION_PROVIDER` / `ANTHROPIC_API_KEY` / `ANTHROPIC_MODEL` | for receipt AI and AI voice interpretation | Default model `claude-opus-5-5`. Server-side refusal fallback is enabled. |
| `AI_TRANSCRIPTION_PROVIDER` / `OPENAI_API_KEY` / `OPENAI_TRANSCRIBE_MODEL` | for server-side speech-to-text | Default `gpt-4o-transcribe` |
| `VOICE_PARSER` | no | `auto` (default), `rules`, or `ai` |
| `AI_RATE_LIMIT_SCANS_PER_HOUR`, `AI_RATE_LIMIT_TRANSCRIPTIONS_PER_HOUR` | no | Per-user limits |
| `CRON_SECRET` | for retention job | |

AI keys are read only in server code (`import "server-only"`).

If AI keys are missing, the app still works:
* **Scanning:** the receipt is read **for free on the user's device** with Tesseract.js (English + Malay), see below.
* **Voice:** without OpenAI, the browser's speech recognition is used if available, otherwise typing. The free rule parser still interprets the text.

To use a different provider, implement `ReceiptVisionProvider`, `TranscriptionProvider` or `ExpenseTextInterpreter` (`src/lib/ai/types.ts`) and register it in `src/lib/ai/index.ts`.

### Free receipt reading (on-device OCR)

When no `ANTHROPIC_API_KEY` is set, or the AI fails or hits its hourly limit, the scan screen reads the
receipt in the browser with Tesseract.js. It costs nothing and the image is not sent to any AI service for this step.

* **Assets:** the worker, WASM core and `eng` + `msa` language data are self-hosted from `public/ocr/`.
  `scripts/copy-ocr-assets.mjs` copies them on `postinstall` / `prebuild`. The first scan downloads about 7 MB;
  the service worker caches it after that.
* **Parsing:** `src/lib/ocr/parse-receipt-text.ts` turns the text into the same structure the AI returns.
  * Recognised lines include TOTAL/JUMLAH, SUBTOTAL, SST/GST, service charge, discount, rounding, CASH/TUNAI, CHANGE/BAKI and card or e-wallet payments.
  * It also picks up the date, time and merchant.
  * The result then goes through the same `sanitizeReceipt()` and `resolveReceiptTotal()` checks as AI output.
* **Always reviewed:** OCR confidence is capped at 0.75, so every OCR result is marked for review and the
  user must tick "I've checked this amount". A missing total is never invented.
* **Limits:** it is less accurate than AI on blurred, crumpled, faded thermal or handwritten receipts.
  Individual item lines are best-effort.

### Receipt retention job

Schedule this once a day, for example with Vercel Cron:

`GET /api/cron/cleanup` with header `Authorization: Bearer $CRON_SECRET`

It deletes:
* unattached temporary uploads after 24 hours
* images older than 90 days for users who chose "90 days"

"Don't keep after saving" deletes the image as soon as the expense is saved.

### Run

```bash
npm run dev            # development
npm run build && npm start
```

## Testing

```bash
npm test               # unit tests: money, periods, aggregation, voice parser, receipt totals, duplicates, CSV, validation
npm run typecheck
npm run test:db        # migrations + RLS/integrity tests on a throwaway local PostgreSQL (needs PostgreSQL binaries)
node e2e/smoke.mjs     # end-to-end browser test against a running app + Supabase (needs Playwright)
```

`e2e/smoke.mjs` signs up two users and covers:
* manual, voice (typed) and scan (no AI key) entry
* duplicate warnings (manual entry and re-scanning the same receipt image)
* search, filters, CSV export, signed-URL receipt preview
* moving an expense between workspaces, deleting
* period filters, reports, category management
* Malay localisation and dark mode
* cross-user isolation and unauthenticated API rejection
* the desktop layout

## Deployment

* **Hosting:** deploy to any Node host (Vercel recommended). Set the environment variables above. Route handlers that use `sharp` run on the Node runtime.
* **Uploads:** receipts are capped at 10 MB and audio at 15 MB / 120 s. Raise your platform's body-size limit if needed.
* **PWA:**
  * served from `app/manifest.ts` and `public/sw.js`
  * the service worker caches only static assets; pages, API responses and financial data are never cached
  * installable on Android/desktop Chrome, and from "Add to Home Screen" on iOS
* **Security headers** are set in `next.config.ts`.

## Known limitations

* MYR only in this version. Receipts in another currency get a warning, and the amount is recorded as MYR after the user confirms.
* Default category names are stored as data and shown in English even when the UI is in Bahasa Melayu (they can be renamed).
* With the in-browser speech recognition fallback, audio is processed by the browser vendor's service.
* If someone opens an expense ID they don't own, they see the not-found page, but the HTTP status is 200 because Next.js streams the page.
