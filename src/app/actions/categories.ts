"use server";

import { revalidatePath } from "next/cache";
import { bookColumns, getContext } from "@/lib/data";
import { categoryNameSchema, uuid } from "@/lib/validation";

type Result = { ok: true } | { ok: false; error: string };

export async function createCategory(workspaceId: string, name: string): Promise<Result> {
  const ctx = await getContext();
  const n = categoryNameSchema.safeParse(name);
  if (!n.success) return { ok: false, error: n.error.issues[0].message };
  const book = bookColumns(ctx, workspaceId);
  if (!book) return { ok: false, error: "Invalid workspace" };
  const maxOrder = Math.max(0, ...ctx.categories.filter((c) => c.workspaceId === workspaceId).map((c) => c.sortOrder));
  const { error } = await ctx.supabase
    .from("expense_categories")
    .insert({
      scope: book.scope,
      user_id: book.scope === "personal" ? ctx.user.id : null,
      organization_id: book.organization_id,
      name: n.data,
      sort_order: maxOrder + 1,
      icon: "tag",
    });
  if (error) return { ok: false, error: error.code === "23505" ? "A category with this name already exists" : "Could not create category" };
  revalidatePath("/", "layout");
  return { ok: true };
}

export async function renameCategory(id: string, name: string): Promise<Result> {
  const ctx = await getContext();
  const n = categoryNameSchema.safeParse(name);
  if (!uuid.safeParse(id).success || !n.success) return { ok: false, error: n.success ? "Invalid category" : n.error.issues[0].message };
  const { error } = await ctx.supabase.from("expense_categories").update({ name: n.data }).eq("id", id);
  if (error) return { ok: false, error: error.code === "23505" ? "A category with this name already exists" : "Could not rename" };
  revalidatePath("/", "layout");
  return { ok: true };
}

export async function setCategoryArchived(id: string, archived: boolean): Promise<Result> {
  const ctx = await getContext();
  if (!uuid.safeParse(id).success) return { ok: false, error: "Invalid category" };
  const cat = ctx.categories.find((c) => c.id === id);
  if (!cat) return { ok: false, error: "Not found" };
  if (archived) {
    const remaining = ctx.categories.filter((c) => c.workspaceId === cat.workspaceId && !c.archived && c.id !== id);
    if (remaining.length === 0) return { ok: false, error: "Keep at least one active category" };
  }
  const { error } = await ctx.supabase
    .from("expense_categories")
    .update({ archived_at: archived ? new Date().toISOString() : null })
    .eq("id", id);
  if (error) return { ok: false, error: error.code === "23505" ? "An active category with this name already exists" : "Could not update" };
  revalidatePath("/", "layout");
  return { ok: true };
}
