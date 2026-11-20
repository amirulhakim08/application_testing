"use server";

import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import { getBaseContext, getContext } from "@/lib/data";
import { LANG_COOKIE } from "@/lib/i18n";
import { createAdminClient } from "@/lib/supabase/admin";
import { RECEIPT_BUCKET, deleteReceiptImages } from "@/lib/receipt-storage";
import { ORG_ASSETS_BUCKET } from "@/lib/org-assets";

type Result = { ok: true } | { ok: false; error: string };

export async function updateProfile(fullName: string): Promise<Result> {
  const ctx = await getBaseContext();
  const n = z.string().trim().max(120).safeParse(fullName);
  if (!n.success) return { ok: false, error: "Name is too long" };
  const { error } = await ctx.supabase.from("profiles").update({ full_name: n.data || null }).eq("id", ctx.user.id);
  if (error) return { ok: false, error: "Could not save" };
  revalidatePath("/", "layout");
  return { ok: true };
}

export async function changePassword(password: string, confirm: string): Promise<Result> {
  const ctx = await getBaseContext();
  const p = z.string().min(8, "Password must be at least 8 characters").max(72).safeParse(password);
  if (!p.success) return { ok: false, error: p.error.issues[0].message };
  if (password !== confirm) return { ok: false, error: "Passwords do not match" };
  const { error } = await ctx.supabase.auth.updateUser({ password: p.data });
  if (error) return { ok: false, error: error.code === "weak_password" ? "Please choose a stronger password." : error.code === "same_password" ? "Choose a password you have not used here." : "Could not change password" };
  await ctx.supabase.from("audit_logs").insert({ user_id: ctx.user.id, action: "auth.password_change", entity: "user", entity_id: ctx.user.id });
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
  // Businesses this user owns are deleted with the account (MVP: one owner per business).
  const { data: owned } = await admin.from("organization_members").select("organization_id").eq("user_id", ctx.user.id).eq("role", "owner");
  for (const o of owned ?? []) {
    const orgId = o.organization_id as string;
    const { data: assets } = await admin.storage.from(ORG_ASSETS_BUCKET).list(orgId, { limit: 100 });
    if (assets?.length) await admin.storage.from(ORG_ASSETS_BUCKET).remove(assets.map((a) => `${orgId}/${a.name}`));
    // Proofs of payment: "<org>/<payment>/<file>"
    const { data: proofs } = await admin.from("payments").select("proof_path").eq("organization_id", orgId).not("proof_path", "is", null);
    const proofPaths = (proofs ?? []).map((p) => p.proof_path as string);
    for (let i = 0; i < proofPaths.length; i += 100) await admin.storage.from("payment-proofs").remove(proofPaths.slice(i, i + 100));
    await admin.from("organizations").delete().eq("id", orgId);
  }
  const { error } = await admin.auth.admin.deleteUser(ctx.user.id);
  if (error) return { ok: false, error: "Could not delete account" };
  await ctx.supabase.auth.signOut();
  redirect("/login");
}
