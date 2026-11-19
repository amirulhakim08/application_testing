"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { bookColumns, getContext, scopeFilter, type AppContext } from "@/lib/data";
import { centsToDecimalString } from "@/lib/money";
import { expenseInputSchema, uuid, type ExpenseInput, type ExpenseParsed } from "@/lib/validation";
import { lookupDuplicates } from "@/lib/duplicate-lookup";
import { deleteReceiptImages } from "@/lib/receipt-storage";
import type { DuplicateLevel } from "@/lib/duplicates";
import { parseToCents } from "@/lib/money";

export interface DuplicateInfo {
  index: number;
  level: DuplicateLevel;
  expense: { id: string; amountCents: number; date: string; merchant: string | null; description: string | null };
}

export type SaveResult =
  | { ok: true; ids: string[] }
  | { ok: false; error: string; fieldErrors?: Record<string, string>; index?: number }
  | { ok: false; error: "duplicate"; duplicates: DuplicateInfo[] };

function firstErrors(err: z.ZodError): Record<string, string> {
  const out: Record<string, string> = {};
  for (const i of err.issues) {
    const k = String(i.path[0] ?? "form");
    if (!out[k]) out[k] = i.message;
  }
  return out;
}

async function validateRefs(ctx: AppContext, e: ExpenseParsed): Promise<string | null> {
  const ws = ctx.workspaces.find((w) => w.id === e.workspaceId);
  if (!ws) return "Invalid workspace";
  if (e.categoryId) {
    const c = ctx.categories.find((x) => x.id === e.categoryId);
    if (!c || c.workspaceId !== e.workspaceId) return "Category does not belong to this workspace";
  }
  if (e.currency !== "MYR") return "Only MYR is supported in this version";
  return null;
}

function toRow(ctx: AppContext, e: ExpenseParsed) {
  const book = bookColumns(ctx, e.workspaceId);
  if (!book) throw new Error("Invalid workspace");
  return {
    user_id: ctx.user.id,
    scope: book.scope,
    organization_id: book.organization_id,
    payment_method: e.paymentMethod ?? null,
    category_id: e.categoryId,
    amount: centsToDecimalString(e.amount),
    currency: e.currency,
    merchant: e.merchant,
    description: e.description,
    notes: e.notes,
    expense_date: e.expenseDate,
    expense_time: e.expenseTime,
    tax_amount: e.taxAmount === null ? null : centsToDecimalString(e.taxAmount),
    discount_amount: e.discountAmount === null ? null : centsToDecimalString(e.discountAmount),
  };
}

/** Save one or more confirmed expenses. Never called without explicit user confirmation in the UI. */
export async function saveExpenses(inputs: ExpenseInput[]): Promise<SaveResult> {
  if (!Array.isArray(inputs) || inputs.length === 0 || inputs.length > 20) return { ok: false, error: "Nothing to save" };
  const ctx = await getContext();

  const parsed: ExpenseParsed[] = [];
  for (let i = 0; i < inputs.length; i++) {
    const r = expenseInputSchema.safeParse(inputs[i]);
    if (!r.success) return { ok: false, error: "Please check the highlighted fields", fieldErrors: firstErrors(r.error), index: i };
    const refErr = await validateRefs(ctx, r.data);
    if (refErr) return { ok: false, error: refErr, index: i };
    parsed.push(r.data);
  }

  // Receipt fingerprints for duplicate detection
  const receiptIds = parsed.map((p) => p.receiptFileId).filter((x): x is string => Boolean(x));
  const shaById = new Map<string, string>();
  if (receiptIds.length) {
    const { data } = await ctx.supabase.from("receipt_files").select("id, sha256").in("id", receiptIds);
    for (const r of data ?? []) shaById.set(r.id, r.sha256);
    if (shaById.size !== new Set(receiptIds).size) return { ok: false, error: "Receipt not found" };
  }

  const duplicates: DuplicateInfo[] = [];
  for (let i = 0; i < parsed.length; i++) {
    const p = parsed[i];
    if (p.confirmDuplicate) continue;
    const matches = await lookupDuplicates(ctx, {
      amountCents: p.amount,
      date: p.expenseDate,
      merchant: p.merchant ?? p.description,
      imageSha256: p.receiptFileId ? shaById.get(p.receiptFileId) : null,
    });
    const strong = matches.filter((m) => m.level !== "possible" || p.entryMethod === "receipt_scan");
    for (const m of strong.slice(0, 3)) {
      duplicates.push({
        index: i,
        level: m.level,
        expense: { id: m.expense.id, amountCents: m.expense.amountCents, date: m.expense.date, merchant: m.expense.merchant, description: m.expense.description },
      });
    }
  }
  if (duplicates.length) return { ok: false, error: "duplicate", duplicates };

  const rows = parsed.map((p) => ({
    ...toRow(ctx, p),
    entry_method: p.entryMethod,
    receipt_file_id: p.receiptFileId,
    ai_extraction_id: p.aiExtractionId,
  }));
  const { data: inserted, error } = await ctx.supabase.from("expenses").insert(rows).select("id");
  if (error || !inserted) return { ok: false, error: "Could not save expense" };
  const ids = inserted.map((r) => r.id as string);

  // Line items (informational)
  const items = parsed.flatMap((p, i) =>
    (p.items ?? []).map((it, pos) => ({
      expense_id: ids[i],
      name: it.name,
      quantity: it.quantity,
      amount: it.amount && parseToCents(it.amount) !== null ? centsToDecimalString(parseToCents(it.amount)!) : null,
      position: pos,
    })),
  );
  if (items.length) await ctx.supabase.from("expense_items").insert(items);

  if (receiptIds.length) {
    await ctx.supabase.from("receipt_files").update({ attached_at: new Date().toISOString() }).in("id", receiptIds);
    if (ctx.preferences.receiptRetention === "none") {
      const { data: files } = await ctx.supabase.from("receipt_files").select("id, storage_path").in("id", receiptIds);
      await deleteReceiptImages(ctx.supabase, files ?? []);
    }
  }

  // Remember last workspace/category for faster entry next time
  const last = parsed[parsed.length - 1];
  const lastCats = { ...ctx.preferences.lastCategoryByWorkspace };
  if (last.categoryId) lastCats[last.workspaceId] = last.categoryId;
  const lastBook = bookColumns(ctx, last.workspaceId);
  await ctx.supabase
    .from("user_preferences")
    .update({
      last_scope: lastBook?.scope ?? "personal",
      last_organization_id: lastBook?.organization_id ?? null,
      last_category_by_workspace: lastCats,
    })
    .eq("user_id", ctx.user.id);

  await ctx.supabase.from("audit_logs").insert(
    ids.map((id, i) => ({
      user_id: ctx.user.id,
      organization_id: bookColumns(ctx, parsed[i].workspaceId)?.organization_id ?? null,
      action: "expense.create",
      entity: "expense",
      entity_id: id,
      metadata: { method: parsed[i].entryMethod },
    })),
  );

  revalidatePath("/", "layout");
  return { ok: true, ids };
}

export async function updateExpense(id: string, input: ExpenseInput): Promise<SaveResult> {
  if (!uuid.safeParse(id).success) return { ok: false, error: "Invalid id" };
  const ctx = await getContext();
  const r = expenseInputSchema.safeParse(input);
  if (!r.success) return { ok: false, error: "Please check the highlighted fields", fieldErrors: firstErrors(r.error) };
  const refErr = await validateRefs(ctx, r.data);
  if (refErr) return { ok: false, error: refErr };

  const update: Record<string, unknown> = toRow(ctx, r.data);
  delete update.user_id;
  if (r.data.receiptFileId) update.receipt_file_id = r.data.receiptFileId;

  const { data, error } = await ctx.supabase
    .from("expenses")
    .update(update)
    .eq("id", id)
    .is("deleted_at", null)
    .or(scopeFilter(ctx))
    .select("id");
  if (error || !data?.length) return { ok: false, error: "Could not update expense" };
  if (r.data.receiptFileId) await ctx.supabase.from("receipt_files").update({ attached_at: new Date().toISOString() }).eq("id", r.data.receiptFileId);

  await ctx.supabase.from("audit_logs").insert({ user_id: ctx.user.id, action: "expense.update", entity: "expense", entity_id: id });
  revalidatePath("/", "layout");
  return { ok: true, ids: [id] };
}

export async function deleteExpense(id: string): Promise<{ ok: boolean }> {
  if (!uuid.safeParse(id).success) return { ok: false };
  const ctx = await getContext();
  const { data, error } = await ctx.supabase
    .from("expenses")
    .update({ deleted_at: new Date().toISOString() })
    .eq("id", id)
    .is("deleted_at", null)
    .or(scopeFilter(ctx))
    .select("id");
  if (error || !data?.length) return { ok: false };
  await ctx.supabase.from("audit_logs").insert({ user_id: ctx.user.id, action: "expense.delete", entity: "expense", entity_id: id });
  revalidatePath("/", "layout");
  return { ok: true };
}
