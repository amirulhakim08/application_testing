"use client";

import * as React from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Loader2, MailCheck } from "lucide-react";
import { useI18n } from "@/components/providers";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/input";
import { PasswordInput } from "@/components/ui/password-input";
import { requestPasswordReset, signIn, signUp, updatePassword, type AuthState } from "@/app/actions/auth";
import { setLanguageCookie } from "@/app/actions/settings";

function Submit({ children, pending }: { children: React.ReactNode; pending: boolean }) {
  return (
    <Button type="submit" size="lg" className="w-full" disabled={pending}>
      {pending && <Loader2 className="animate-spin" />}
      {children}
    </Button>
  );
}

function ErrorText({ state }: { state: AuthState }) {
  const { t } = useI18n();
  if (!state?.error) return null;
  return (
    <p role="alert" className="rounded-xl bg-warning-soft px-3 py-2 text-sm text-warning">
      {t(state.error as "auth.err.login")}
    </p>
  );
}

export function LanguageToggle() {
  const { lang } = useI18n();
  return (
    <div className="flex gap-1 text-xs">
      {(["en", "ms"] as const).map((l) => (
        <button key={l} type="button" onClick={() => setLanguageCookie(l)} className={l === lang ? "font-semibold text-foreground" : "text-muted-foreground hover:text-foreground"}>
          {l === "en" ? "EN" : "BM"}
        </button>
      ))}
    </div>
  );
}

export function LoginForm() {
  const { t } = useI18n();
  const next = useSearchParams().get("next") ?? "/";
  const linkError = useSearchParams().get("error") === "link";
  const [state, action, pending] = React.useActionState(signIn, undefined);
  return (
    <form action={action} className="grid gap-4">
      <input type="hidden" name="next" value={next} />
      {linkError && <p className="rounded-xl bg-warning-soft px-3 py-2 text-sm text-warning">{t("auth.err.link")}</p>}
      <div>
        <Label htmlFor="email">{t("auth.email")}</Label>
        <Input id="email" name="email" type="email" autoComplete="email" required />
      </div>
      <div>
        <div className="flex items-baseline justify-between">
          <Label htmlFor="password">{t("auth.password")}</Label>
          <Link href="/forgot-password" className="text-xs font-medium text-primary">
            {t("auth.forgot")}
          </Link>
        </div>
        <PasswordInput id="password" name="password" autoComplete="current-password" required />
      </div>
      <ErrorText state={state} />
      <Submit pending={pending}>{t("auth.login")}</Submit>
      <p className="text-center text-sm text-muted-foreground">
        {t("auth.noAccount")}{" "}
        <Link href="/signup" className="font-medium text-primary">
          {t("auth.signup")}
        </Link>
      </p>
    </form>
  );
}

export function SignupForm() {
  const { t } = useI18n();
  const [state, action, pending] = React.useActionState(signUp, undefined);
  if (state?.message === "check_email") {
    return (
      <div className="grid place-items-center gap-4 py-6 text-center">
        <MailCheck className="size-12 text-primary" />
        <p className="text-sm">{t("auth.checkEmail")}</p>
        <Button asChild variant="outline">
          <Link href="/login">{t("auth.login")}</Link>
        </Button>
      </div>
    );
  }
  return (
    <form action={action} className="grid gap-4">
      <div>
        <Label htmlFor="fullName">{t("auth.fullName")}</Label>
        <Input id="fullName" name="fullName" autoComplete="name" maxLength={120} />
      </div>
      <div>
        <Label htmlFor="email">{t("auth.email")}</Label>
        <Input id="email" name="email" type="email" autoComplete="email" required />
      </div>
      <div>
        <Label htmlFor="password">{t("auth.password")}</Label>
        <PasswordInput id="password" name="password" autoComplete="new-password" minLength={8} required />
        <p className="mt-1 text-xs text-muted-foreground">{t("auth.passwordHint")}</p>
      </div>
      <ErrorText state={state} />
      <Submit pending={pending}>{t("auth.signup")}</Submit>
      <p className="text-center text-sm text-muted-foreground">
        {t("auth.haveAccount")}{" "}
        <Link href="/login" className="font-medium text-primary">
          {t("auth.login")}
        </Link>
      </p>
    </form>
  );
}

export function ForgotForm() {
  const { t } = useI18n();
  const [state, action, pending] = React.useActionState(requestPasswordReset, undefined);
  if (state?.message === "reset_sent") return <p className="rounded-xl bg-primary-soft p-4 text-sm text-primary">{t("auth.resetSent")}</p>;
  return (
    <form action={action} className="grid gap-4">
      <div>
        <Label htmlFor="email">{t("auth.email")}</Label>
        <Input id="email" name="email" type="email" autoComplete="email" required />
      </div>
      <ErrorText state={state} />
      <Submit pending={pending}>{t("auth.sendReset")}</Submit>
      <Link href="/login" className="text-center text-sm font-medium text-primary">
        {t("common.back")}
      </Link>
    </form>
  );
}

export function UpdatePasswordForm() {
  const { t } = useI18n();
  const [state, action, pending] = React.useActionState(updatePassword, undefined);
  return (
    <form action={action} className="grid gap-4">
      <div>
        <Label htmlFor="password">{t("auth.newPassword")}</Label>
        <PasswordInput id="password" name="password" autoComplete="new-password" minLength={8} required />
        <p className="mt-1 text-xs text-muted-foreground">{t("auth.passwordHint")}</p>
      </div>
      <ErrorText state={state} />
      <Submit pending={pending}>{t("auth.updatePassword")}</Submit>
    </form>
  );
}
