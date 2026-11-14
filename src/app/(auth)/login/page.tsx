import { Suspense } from "react";
import { getI18n } from "@/lib/i18n/server";
import { AuthShell } from "@/components/app/auth-shell";
import { LoginForm } from "@/components/app/auth-forms";

export const metadata = { title: "Log in" };

export default async function LoginPage() {
  const { t } = await getI18n();
  return (
    <AuthShell title={t("auth.welcome")} subtitle={t("app.tagline")} tagline={t("app.tagline")}>
      <Suspense>
        <LoginForm />
      </Suspense>
    </AuthShell>
  );
}
