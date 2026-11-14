import { getI18n } from "@/lib/i18n/server";
import { AuthShell } from "@/components/app/auth-shell";
import { SignupForm } from "@/components/app/auth-forms";

export const metadata = { title: "Create account" };

export default async function SignupPage() {
  const { t } = await getI18n();
  return (
    <AuthShell title={t("auth.signup")} subtitle={t("auth.start")} tagline={t("app.tagline")}>
      <SignupForm />
    </AuthShell>
  );
}
