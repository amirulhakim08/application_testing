import "server-only";
import { cache } from "react";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { parseToCents, type Cents } from "@/lib/money";
import type { LedgerRow, WorkspaceKind } from "@/lib/aggregate";
import type { ISODate } from "@/lib/dates";
import { normalizeLang, type Lang } from "@/lib/i18n";
import { categoryLabel } from "@/lib/category-labels";

/**
 * An expense "book". Personal = the signed-in user (id = user id). Company = the active business organization
 * (id = organization id). The UI keeps the KiraGo "workspace" vocabulary; the database stores an explicit
 * scope ("personal" | "business") plus organization_id.
 */
export interface Workspace {
  id: string;
  kind: WorkspaceKind;
  name: string;
}
export interface Organization {
  id: string;
  name: string;
  registrationNo: string | null;
  address: string | null;
  email: string | null;
  phone: string | null;
  website: string | null;
  logoPath: string | null;
  bankName: string | null;
  bankAccountNo: string | null;
  bankAccountHolder: string | null;
  role: "owner" | "admin" | "staff";
}
export interface OrganizationSettings {
  documentTemplate: "classic" | "modern" | "navy";
  quotationPrefix: string;
  invoicePrefix: string;
  deliveryOrderPrefix: string;
  receiptPrefix: string;
  paymentTermsDays: number;
  quotationValidityDays: number;
  taxLabel: string;
  defaultTaxRate: string;
  taxRegistrationNo: string | null;
  defaultNotes: string | null;
  defaultTerms: string | null;
  onboardingCompleted: boolean;
}
export interface Category {
  id: string;
  workspaceId: string;
  name: string;
  /** Display name in the user's language (default categories translated). */
  label: string;
  icon: string | null;
  archived: boolean;
  sortOrder: number;
}
export interface Preferences {
  language: Lang;
  theme: "system" | "light" | "dark";
  currency: string;
  receiptRetention: "keep" | "days_90" | "none";
  lastWorkspaceId: string | null;
  lastCategoryByWorkspace: Record<string, string>;
}
export interface Expense {
  id: string;
  workspaceId: string;
  workspaceKind: WorkspaceKind;
  categoryId: string | null;
  amountCents: Cents;
  currency: string;
  merchant: string | null;
  description: string | null;
  notes: string | null;
  date: ISODate;
  time: string | null;
  taxCents: Cents | null;
  discountCents: Cents | null;
  paymentMethod: PaymentMethod | null;
  entryMethod: "receipt_scan" | "voice" | "manual";
  receiptFileId: string | null;
  createdAt: string;
}
export type PaymentMethod = "cash" | "debit_card" | "credit_card" | "online_banking" | "ewallet" | "other";

export const EXPENSE_COLUMNS =
  "id, scope, user_id, organization_id, category_id, amount::text, currency, merchant, description, notes, expense_date, expense_time, tax_amount::text, discount_amount::text, payment_method, entry_method, receipt_file_id, created_at";

type Row = Record<string, unknown>;

/** Book id of a row: organization id for business rows, the recording user's id for personal rows. */
export function bookIdOf(r: Row): string {
  return r.scope === "business" ? (r.organization_id as string) : (r.user_id as string);
}

export function mapExpense(r: Row): Expense {
  return {
    id: r.id as string,
    workspaceId: bookIdOf(r),
    workspaceKind: r.scope === "business" ? "company" : "personal",
    categoryId: (r.category_id as string) ?? null,
    amountCents: parseToCents(r.amount as string) ?? 0,
    currency: (r.currency as string) ?? "MYR",
    merchant: (r.merchant as string) ?? null,
    description: (r.description as string) ?? null,
    notes: (r.notes as string) ?? null,
    date: r.expense_date as string,
    time: r.expense_time ? String(r.expense_time).slice(0, 5) : null,
    taxCents: r.tax_amount ? parseToCents(r.tax_amount as string) : null,
    discountCents: r.discount_amount ? parseToCents(r.discount_amount as string) : null,
    paymentMethod: (r.payment_method as PaymentMethod) ?? null,
    entryMethod: r.entry_method as Expense["entryMethod"],
    receiptFileId: (r.receipt_file_id as string) ?? null,
    createdAt: r.created_at as string,
  };
}

function mapOrganization(o: Row, role: Organization["role"]): Organization {
  return {
    id: o.id as string,
    name: o.name as string,
    registrationNo: (o.registration_no as string) ?? null,
    address: (o.address as string) ?? null,
    email: (o.email as string) ?? null,
    phone: (o.phone as string) ?? null,
    website: (o.website as string) ?? null,
    logoPath: (o.logo_path as string) ?? null,
    bankName: (o.bank_name as string) ?? null,
    bankAccountNo: (o.bank_account_no as string) ?? null,
    bankAccountHolder: (o.bank_account_holder as string) ?? null,
    role,
  };
}

function mapSettings(s: Row | null): OrganizationSettings {
  return {
    documentTemplate: ((s?.document_template as string) ?? "modern") as OrganizationSettings["documentTemplate"],
    quotationPrefix: (s?.quotation_prefix as string) ?? "QT",
    invoicePrefix: (s?.invoice_prefix as string) ?? "INV",
    deliveryOrderPrefix: (s?.delivery_order_prefix as string) ?? "DO",
    receiptPrefix: (s?.receipt_prefix as string) ?? "RC",
    paymentTermsDays: (s?.payment_terms_days as number) ?? 30,
    quotationValidityDays: (s?.quotation_validity_days as number) ?? 30,
    taxLabel: (s?.tax_label as string) ?? "SST",
    defaultTaxRate: String(s?.default_tax_rate ?? "0"),
    taxRegistrationNo: (s?.tax_registration_no as string) ?? null,
    defaultNotes: (s?.default_notes as string) ?? null,
    defaultTerms: (s?.default_terms as string) ?? null,
    onboardingCompleted: Boolean(s?.onboarding_completed_at),
  };
}

const ORG_COLUMNS =
  "id, name, registration_no, address, email, phone, website, logo_path, bank_name, bank_account_no, bank_account_holder";
const CATEGORY_COLUMNS = "id, scope, user_id, organization_id, name, icon, archived_at, sort_order";

/**
 * Signed-in user + profile + preferences + their business (if any). Cached per request.
 * Does NOT require onboarding to be complete — use getContext() for app pages.
 */
export const getBaseContext = cache(async () => {
  const supabase = await createClient();
  // Verified JWT claims (local verification with asymmetric keys; Auth-server fallback otherwise).
  const { data: claimsData } = await supabase.auth.getClaims();
  const claims = claimsData?.claims;
  if (!claims?.sub) redirect("/login");
  const user = { id: claims.sub as string, email: (claims.email as string | undefined) ?? "" };

  let [{ data: prefs }, { data: profile }, { data: memberships }] = await Promise.all([
    supabase.from("user_preferences").select("*").maybeSingle(),
    supabase.from("profiles").select("full_name").maybeSingle(),
    supabase.from("organization_members").select("organization_id, role").eq("user_id", user.id),
  ]);

  // Self-heal accounts created before the onboarding trigger existed.
  if (!prefs || !profile) {
    await supabase.rpc("ensure_my_profile");
    [{ data: prefs }, { data: profile }] = await Promise.all([
      supabase.from("user_preferences").select("*").maybeSingle(),
      supabase.from("profiles").select("full_name").maybeSingle(),
    ]);
  }

  // Active business: the remembered one if the user still belongs to it, else the first (owner first).
  const members = (memberships ?? []) as Array<{ organization_id: string; role: Organization["role"] }>;
  members.sort((a, b) => (a.role === "owner" ? -1 : 0) - (b.role === "owner" ? -1 : 0));
  const active = members.find((m) => m.organization_id === prefs?.active_organization_id) ?? members[0] ?? null;

  let organization: Organization | null = null;
  let settings: OrganizationSettings = mapSettings(null);
  if (active) {
    const [{ data: org }, { data: s }] = await Promise.all([
      supabase.from("organizations").select(ORG_COLUMNS).eq("id", active.organization_id).maybeSingle(),
      supabase.from("organization_settings").select("*").eq("organization_id", active.organization_id).maybeSingle(),
    ]);
    if (org) {
      organization = mapOrganization(org as Row, active.role);
      settings = mapSettings((s as Row) ?? null);
    }
  }

  const language = normalizeLang(prefs?.language);
  const lastWorkspaceId =
    prefs?.last_scope === "business" && organization && prefs?.last_organization_id === organization.id ? organization.id : user.id;
  const preferences: Preferences = {
    language,
    theme: prefs?.theme ?? "system",
    currency: prefs?.currency ?? "MYR",
    receiptRetention: prefs?.receipt_retention ?? "keep",
    lastWorkspaceId,
    lastCategoryByWorkspace: (prefs?.last_category_by_workspace as Record<string, string>) ?? {},
  };

  return {
    supabase,
    user: { id: user.id, email: user.email ?? "", fullName: (profile?.full_name as string | null) ?? null },
    organization,
    settings,
    preferences,
  };
});

/** Everything an app page needs. Redirects to onboarding until the user has a business. */
export const getContext = cache(async () => {
  const base = await getBaseContext();
  if (!base.organization) redirect("/onboarding");
  if (!base.settings.onboardingCompleted && base.organization.role !== "staff") redirect("/onboarding");
  const org = base.organization;
  const { supabase, user, preferences } = base;

  const { data: categories } = await supabase
    .from("expense_categories")
    .select(CATEGORY_COLUMNS)
    .or(`and(scope.eq.personal,user_id.eq.${user.id}),and(scope.eq.business,organization_id.eq.${org.id})`)
    .order("sort_order")
    .order("name");

  const personal: Workspace = { id: user.id, kind: "personal", name: "Personal" };
  const company: Workspace = { id: org.id, kind: "company", name: org.name };
  const ws: Workspace[] = [personal, company];
  const cats: Category[] = (categories ?? []).map((c) => ({
    id: c.id as string,
    workspaceId: bookIdOf(c as Row),
    name: c.name as string,
    label: categoryLabel(c.name as string, preferences.language),
    icon: (c.icon as string) ?? null,
    archived: Boolean(c.archived_at),
    sortOrder: c.sort_order as number,
  }));
  const kindOf = (id: string): WorkspaceKind => (id === org.id ? "company" : "personal");

  return {
    ...base,
    organization: org,
    workspaces: ws,
    personal,
    company,
    categories: cats,
    kindOf,
  };
});

/** Restrict an expenses query to the user's personal book plus the active business. */
export function scopeFilter(ctx: { user: { id: string }; company: { id: string } }) {
  return `and(scope.eq.personal,user_id.eq.${ctx.user.id}),and(scope.eq.business,organization_id.eq.${ctx.company.id})`;
}

/** Translate a book id from the UI into database columns, or null if it is not one of the user's books. */
export function bookColumns(ctx: { user: { id: string }; company: { id: string } }, workspaceId: string) {
  if (workspaceId === ctx.user.id) return { scope: "personal" as const, organization_id: null };
  if (workspaceId === ctx.company.id) return { scope: "business" as const, organization_id: ctx.company.id };
  return null;
}

export type AppContext = Awaited<ReturnType<typeof getContext>>;

/** Saved, non-deleted expenses in [from, to] reduced to reporting fields. */
export async function getLedger(ctx: AppContext, from: ISODate, to: ISODate): Promise<LedgerRow[]> {
  const rows: LedgerRow[] = [];
  const PAGE = 1000;
  for (let offset = 0; ; offset += PAGE) {
    const { data, error } = await ctx.supabase
      .from("expenses")
      .select("id, scope, user_id, organization_id, category_id, amount::text, expense_date")
      .is("deleted_at", null)
      .or(scopeFilter(ctx))
      .gte("expense_date", from)
      .lte("expense_date", to)
      .order("id")
      .range(offset, offset + PAGE - 1);
    if (error) throw new Error("Failed to load expenses");
    for (const r of data ?? []) {
      rows.push({
        id: r.id,
        workspaceKind: r.scope === "business" ? "company" : "personal",
        categoryId: r.category_id,
        amountCents: parseToCents(r.amount as unknown as string) ?? 0,
        date: r.expense_date,
      });
    }
    if (!data || data.length < PAGE) break;
  }
  return rows;
}

export interface ExpenseFilters {
  q?: string;
  ws?: WorkspaceKind;
  category?: string;
  from?: ISODate;
  to?: ISODate;
  min?: Cents;
  max?: Cents;
}

export async function listExpenses(ctx: AppContext, f: ExpenseFilters, limit = 200): Promise<Expense[]> {
  let q = ctx.supabase.from("expenses").select(EXPENSE_COLUMNS).is("deleted_at", null);
  if (f.ws === "company") q = q.eq("scope", "business").eq("organization_id", ctx.company.id);
  else if (f.ws === "personal") q = q.eq("scope", "personal").eq("user_id", ctx.user.id);
  else q = q.or(scopeFilter(ctx));
  if (f.category) q = q.eq("category_id", f.category);
  if (f.from) q = q.gte("expense_date", f.from);
  if (f.to) q = q.lte("expense_date", f.to);
  if (f.min !== undefined) q = q.gte("amount", (f.min / 100).toFixed(2));
  if (f.max !== undefined) q = q.lte("amount", (f.max / 100).toFixed(2));
  if (f.q) {
    // Escape PostgREST/LIKE special characters in user input.
    const term = f.q.replace(/[%_\\,().*"]/g, " ").trim().slice(0, 60);
    if (term) q = q.or(`merchant.ilike.*${term}*,description.ilike.*${term}*,notes.ilike.*${term}*`);
  }
  const { data, error } = await q.order("expense_date", { ascending: false }).order("created_at", { ascending: false }).limit(limit);
  if (error) throw new Error("Failed to load expenses");
  return (data ?? []).map((r) => mapExpense(r as Row));
}

export async function getExpense(ctx: AppContext, id: string): Promise<Expense | null> {
  const { data } = await ctx.supabase
    .from("expenses")
    .select(EXPENSE_COLUMNS)
    .eq("id", id)
    .is("deleted_at", null)
    .or(scopeFilter(ctx))
    .maybeSingle();
  return data ? mapExpense(data as Row) : null;
}

export function activeCategoriesFor(ctx: Pick<AppContext, "categories">, workspaceId: string) {
  return ctx.categories.filter((c) => c.workspaceId === workspaceId && !c.archived);
}

export function toRowData(ctx: AppContext, e: Expense) {
  const cat = e.categoryId ? ctx.categories.find((c) => c.id === e.categoryId) : null;
  return {
    id: e.id,
    amountCents: e.amountCents,
    merchant: e.merchant,
    description: e.description,
    date: e.date,
    workspaceKind: e.workspaceKind,
    workspaceName: ctx.workspaces.find((w) => w.id === e.workspaceId)?.name ?? "",
    categoryName: cat?.label ?? null,
    categoryIcon: cat?.icon ?? null,
    entryMethod: e.entryMethod,
    hasReceipt: Boolean(e.receiptFileId),
  };
}
