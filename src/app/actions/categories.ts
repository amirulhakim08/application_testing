"use server";

import { revalidatePath } from "next/cache";
import { getContext } from "@/lib/data";
import { categoryNameSchema, uuid } from "@/lib/validation";

type Result = { ok: true } | { ok: false; error: string };

export async function createCategory(workspaceId: string, name: string): Promise<Result> {
  const ctx = await getContext();
  const n = categoryNameSchema.safeParse(name);
  if (!n.success) return { ok: false, error: n.error.issues[0].message };
  if (!ctx.workspaces.some((w) => w.id === workspaceId)) return { ok: false, error: "Invalid workspace" };
  const maxOrder = Math.max(0, ...ctx.categories.filter((c) => c.workspaceId === workspaceId).map((c) => c.sortOrder));
  const { error } = await ctx.supabase
    .from("expense_categories")
    .insert({ user_id: ctx.user.id, workspace_id: workspaceId, name: n.data, sort_order: maxOrder + 1, icon: "tag" });
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
