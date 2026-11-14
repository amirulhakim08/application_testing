import "server-only";
import { cache } from "react";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { parseToCents, type Cents } from "@/lib/money";
import type { LedgerRow, WorkspaceKind } from "@/lib/aggregate";
import type { ISODate } from "@/lib/dates";
import { normalizeLang, type Lang } from "@/lib/i18n";

export interface Workspace {
  id: string;
  kind: WorkspaceKind;
  name: string;
}
export interface Category {
  id: string;
  workspaceId: string;
  name: string;
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
  entryMethod: "receipt_scan" | "voice" | "manual";
  receiptFileId: string | null;
  createdAt: string;
}

export const EXPENSE_COLUMNS =
  "id, workspace_id, category_id, amount::text, currency, merchant, description, notes, expense_date, expense_time, tax_amount::text, discount_amount::text, entry_method, receipt_file_id, created_at";

type Row = Record<string, unknown>;

export function mapExpense(r: Row, kindOf: (wsId: string) => WorkspaceKind): Expense {
  return {
    id: r.id as string,
    workspaceId: r.workspace_id as string,
    workspaceKind: kindOf(r.workspace_id as string),
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
    entryMethod: r.entry_method as Expense["entryMethod"],
    receiptFileId: (r.receipt_file_id as string) ?? null,
    createdAt: r.created_at as string,
  };
}

/** Authenticated user + workspaces + categories + preferences. Cached per request. */
export const getContext = cache(async () => {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  let [{ data: workspaces }, { data: categories }, { data: prefs }, { data: profile }] = await Promise.all([
    supabase.from("workspaces").select("id, kind, name, created_at").is("archived_at", null).order("created_at"),
    supabase.from("expense_categories").select("id, workspace_id, name, icon, archived_at, sort_order").order("sort_order").order("name"),
    supabase.from("user_preferences").select("*").maybeSingle(),
    supabase.from("profiles").select("full_name").maybeSingle(),
  ]);

  // Self-heal accounts created before onboarding trigger existed.
  if (!workspaces?.length || !prefs) {
    await supabase.rpc("ensure_my_workspaces");
    [{ data: workspaces }, { data: categories }, { data: prefs }] = await Promise.all([
      supabase.from("workspaces").select("id, kind, name, created_at").is("archived_at", null).order("created_at"),
      supabase.from("expense_categories").select("id, workspace_id, name, icon, archived_at, sort_order").order("sort_order").order("name"),
      supabase.from("user_preferences").select("*").maybeSingle(),
    ]);
  }

  const ws: Workspace[] = (workspaces ?? []).map((w) => ({ id: w.id, kind: w.kind, name: w.name }));
  const personal = ws.find((w) => w.kind === "personal")!;
  const company = ws.find((w) => w.kind === "company")!;
  const cats: Category[] = (categories ?? []).map((c) => ({
    id: c.id,
    workspaceId: c.workspace_id,
    name: c.name,
    icon: c.icon,
    archived: Boolean(c.archived_at),
    sortOrder: c.sort_order,
  }));
  const preferences: Preferences = {
    language: normalizeLang(prefs?.language),
    theme: prefs?.theme ?? "system",
    currency: prefs?.currency ?? "MYR",
    receiptRetention: prefs?.receipt_retention ?? "keep",
    lastWorkspaceId: prefs?.last_workspace_id ?? null,
    lastCategoryByWorkspace: (prefs?.last_category_by_workspace as Record<string, string>) ?? {},
  };
  const kindOf = (id: string): WorkspaceKind => ws.find((w) => w.id === id)?.kind ?? "personal";

  return {
    supabase,
    user: { id: user.id, email: user.email ?? "", fullName: (profile?.full_name as string | null) ?? null },
    workspaces: ws,
    personal,
    company,
    categories: cats,
    preferences,
    kindOf,
  };
});

export type AppContext = Awaited<ReturnType<typeof getContext>>;

/** Saved, non-deleted expenses in [from, to] reduced to reporting fields. */
export async function getLedger(ctx: AppContext, from: ISODate, to: ISODate): Promise<LedgerRow[]> {
  const rows: LedgerRow[] = [];
  const PAGE = 1000;
  for (let offset = 0; ; offset += PAGE) {
    const { data, error } = await ctx.supabase
      .from("expenses")
      .select("id, workspace_id, category_id, amount::text, expense_date")
      .is("deleted_at", null)
      .gte("expense_date", from)
      .lte("expense_date", to)
      .order("id")
      .range(offset, offset + PAGE - 1);
    if (error) throw new Error("Failed to load expenses");
    for (const r of data ?? []) {
      rows.push({
        id: r.id,
        workspaceKind: ctx.kindOf(r.workspace_id),
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
  if (f.ws) q = q.eq("workspace_id", f.ws === "company" ? ctx.company.id : ctx.personal.id);
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
  return (data ?? []).map((r) => mapExpense(r as Row, ctx.kindOf));
}

export async function getExpense(ctx: AppContext, id: string): Promise<Expense | null> {
  const { data } = await ctx.supabase.from("expenses").select(EXPENSE_COLUMNS).eq("id", id).is("deleted_at", null).maybeSingle();
  return data ? mapExpense(data as Row, ctx.kindOf) : null;
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
    categoryName: cat?.name ?? null,
    categoryIcon: cat?.icon ?? null,
    entryMethod: e.entryMethod,
    hasReceipt: Boolean(e.receiptFileId),
  };
}
