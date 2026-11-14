import { getI18n } from "@/lib/i18n/server";
import { AuthShell } from "@/components/app/auth-shell";
import { ForgotForm } from "@/components/app/auth-forms";

export const metadata = { title: "Reset password" };

export default async function ForgotPage() {
  const { t } = await getI18n();
  return (
    <AuthShell title={t("auth.reset")} tagline={t("app.tagline")}>
      <ForgotForm />
    </AuthShell>
  );
}
