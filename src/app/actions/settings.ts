"use server";

import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import { getContext } from "@/lib/data";
import { LANG_COOKIE } from "@/lib/i18n";
import { createAdminClient } from "@/lib/supabase/admin";
import { RECEIPT_BUCKET, deleteReceiptImages } from "@/lib/receipt-storage";

type Result = { ok: true } | { ok: false; error: string };

export async function updateProfile(fullName: string, companyName: string): Promise<Result> {
  const ctx = await getContext();
  const n = z.string().trim().max(120).safeParse(fullName);
  const c = z.string().trim().min(1, "Company name is required").max(80).safeParse(companyName);
  if (!n.success) return { ok: false, error: "Name is too long" };
  if (!c.success) return { ok: false, error: c.error.issues[0].message };
  const [p, w] = await Promise.all([
    ctx.supabase.from("profiles").update({ full_name: n.data || null }).eq("id", ctx.user.id),
    ctx.supabase.from("workspaces").update({ name: c.data }).eq("id", ctx.company.id),
  ]);
  if (p.error || w.error) return { ok: false, error: "Could not save" };
  revalidatePath("/", "layout");
  return { ok: true };
}

const prefsSchema = z.object({
  language: z.enum(["en", "ms"]).optional(),
  theme: z.enum(["system", "light", "dark"]).optional(),
  receiptRetention: z.enum(["keep", "days_90", "none"]).optional(),
});

export async function updatePreferences(input: z.input<typeof prefsSchema>): Promise<Result> {
  const ctx = await getContext();
  const r = prefsSchema.safeParse(input);
  if (!r.success) return { ok: false, error: "Invalid preference" };
  const update: Record<string, string> = {};
  if (r.data.language) update.language = r.data.language;
  if (r.data.theme) update.theme = r.data.theme;
  if (r.data.receiptRetention) update.receipt_retention = r.data.receiptRetention;
  const { error } = await ctx.supabase.from("user_preferences").update(update).eq("user_id", ctx.user.id);
  if (error) return { ok: false, error: "Could not save" };
  if (r.data.language) {
    (await cookies()).set(LANG_COOKIE, r.data.language, { path: "/", maxAge: 60 * 60 * 24 * 365, sameSite: "lax" });
  }
  revalidatePath("/", "layout");
  return { ok: true };
}

/** Public: lets signed-out visitors switch language on auth pages. */
export async function setLanguageCookie(lang: "en" | "ms") {
  (await cookies()).set(LANG_COOKIE, lang === "ms" ? "ms" : "en", { path: "/", maxAge: 60 * 60 * 24 * 365, sameSite: "lax" });
  revalidatePath("/", "layout");
}

export async function deleteAllReceiptImages(): Promise<Result> {
  const ctx = await getContext();
  const { data } = await ctx.supabase.from("receipt_files").select("id, storage_path").is("deleted_at", null);
  await deleteReceiptImages(ctx.supabase, data ?? []);
  await ctx.supabase.from("audit_logs").insert({ user_id: ctx.user.id, action: "receipts.delete_all", entity: "receipt_file" });
  revalidatePath("/", "layout");
  return { ok: true };
}

/** Permanently deletes the account. Storage objects first, then the auth user (cascades all rows). */
export async function deleteAccount(confirmation: string): Promise<Result> {
  if (confirmation !== "DELETE") return { ok: false, error: "Type DELETE to confirm" };
  const ctx = await getContext();
  let admin;
  try {
    admin = createAdminClient();
  } catch {
    return { ok: false, error: "Account deletion is not configured on this server" };
  }
  // Remove every stored object under the user's folder
  for (;;) {
    const { data: objects } = await admin.storage.from(RECEIPT_BUCKET).list(ctx.user.id, { limit: 100 });
    if (!objects?.length) break;
    await admin.storage.from(RECEIPT_BUCKET).remove(objects.map((o) => `${ctx.user.id}/${o.name}`));
    if (objects.length < 100) break;
  }
  const { error } = await admin.auth.admin.deleteUser(ctx.user.id);
  if (error) return { ok: false, error: "Could not delete account" };
  await ctx.supabase.auth.signOut();
  redirect("/login");
}
