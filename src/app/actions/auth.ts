"use server";

import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { LANG_COOKIE, normalizeLang } from "@/lib/i18n";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { siteUrl } from "@/lib/env";

export type AuthState = { error?: string; message?: string } | undefined;

const email = z.string().trim().toLowerCase().email("auth.err.email");
const password = z.string().min(8, "auth.err.short").max(72);

function safeNext(next: FormDataEntryValue | null): string {
  const n = typeof next === "string" ? next : "/";
  return n.startsWith("/") && !n.startsWith("//") ? n : "/";
}

export async function signIn(_: AuthState, form: FormData): Promise<AuthState> {
  const parsed = z.object({ email, password: z.string().min(1, "auth.err.noPassword") }).safeParse({
    email: form.get("email"),
    password: form.get("password"),
  });
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword(parsed.data);
  if (error) {
    return { error: error.code === "email_not_confirmed" ? "auth.err.unverified" : "auth.err.login" };
  }
  redirect(safeNext(form.get("next")));
}

export async function signUp(_: AuthState, form: FormData): Promise<AuthState> {
  const parsed = z
    .object({
      email,
      password,
      fullName: z.string().trim().max(120),
    })
    .safeParse({
      email: form.get("email"),
      password: form.get("password"),
      fullName: form.get("fullName") ?? "",
    });
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const supabase = await createClient();
  const { data, error } = await supabase.auth.signUp({
    email: parsed.data.email,
    password: parsed.data.password,
    options: {
      emailRedirectTo: `${siteUrl()}/auth/confirm?next=/`,
      // The language chosen on the sign-up screen becomes the account's language.
      data: { full_name: parsed.data.fullName, language: normalizeLang((await cookies()).get(LANG_COOKIE)?.value) },
    },
  });
  if (error) return { error: error.code === "weak_password" ? "auth.err.weak" : "auth.err.signup" };
  if (data.session) redirect("/"); // email confirmation disabled on this project
  return { message: "check_email" };
}

export async function requestPasswordReset(_: AuthState, form: FormData): Promise<AuthState> {
  const parsed = email.safeParse(form.get("email"));
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const supabase = await createClient();
  await supabase.auth.resetPasswordForEmail(parsed.data, { redirectTo: `${siteUrl()}/auth/confirm?next=/auth/update-password` });
  // Same response whether or not the account exists (no account enumeration)
  return { message: "reset_sent" };
}

export async function updatePassword(_: AuthState, form: FormData): Promise<AuthState> {
  const parsed = password.safeParse(form.get("password"));
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const supabase = await createClient();
  const { error } = await supabase.auth.updateUser({ password: parsed.data });
  if (error) return { error: "auth.err.update" };
  redirect("/");
}

export async function signOut() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/login");
}
