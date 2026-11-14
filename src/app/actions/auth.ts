"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { siteUrl } from "@/lib/env";

export type AuthState = { error?: string; message?: string } | undefined;

const email = z.string().trim().toLowerCase().email("Enter a valid email");
const password = z.string().min(8, "Password must be at least 8 characters").max(72);

function safeNext(next: FormDataEntryValue | null): string {
  const n = typeof next === "string" ? next : "/";
  return n.startsWith("/") && !n.startsWith("//") ? n : "/";
}

export async function signIn(_: AuthState, form: FormData): Promise<AuthState> {
  const parsed = z.object({ email, password: z.string().min(1, "Enter your password") }).safeParse({
    email: form.get("email"),
    password: form.get("password"),
  });
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword(parsed.data);
  if (error) {
    return { error: error.code === "email_not_confirmed" ? "Please verify your email first." : "Incorrect email or password." };
  }
  redirect(safeNext(form.get("next")));
}

export async function signUp(_: AuthState, form: FormData): Promise<AuthState> {
  const parsed = z
    .object({
      email,
      password,
      fullName: z.string().trim().max(120),
      companyName: z.string().trim().max(80),
    })
    .safeParse({
      email: form.get("email"),
      password: form.get("password"),
      fullName: form.get("fullName") ?? "",
      companyName: form.get("companyName") ?? "",
    });
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const supabase = await createClient();
  const { data, error } = await supabase.auth.signUp({
    email: parsed.data.email,
    password: parsed.data.password,
    options: {
      emailRedirectTo: `${siteUrl()}/auth/confirm?next=/`,
      data: { full_name: parsed.data.fullName, company_name: parsed.data.companyName },
    },
  });
  if (error) return { error: error.code === "weak_password" ? "Please choose a stronger password." : "Could not create account." };
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
  if (error) return { error: "Could not update password. The link may have expired." };
  redirect("/");
}

export async function signOut() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/login");
}
