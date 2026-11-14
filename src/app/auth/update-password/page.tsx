import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getI18n } from "@/lib/i18n/server";
import { AuthShell } from "@/components/app/auth-shell";
import { UpdatePasswordForm } from "@/components/app/auth-forms";

export const metadata = { title: "New password" };

export default async function UpdatePasswordPage() {
  const supabase = await createClient();
  const { data } = await supabase.auth.getUser();
  if (!data.user) redirect("/login?error=link");
  const { t } = await getI18n();
  return (
    <AuthShell title={t("auth.updatePassword")} tagline={t("app.tagline")}>
      <UpdatePasswordForm />
    </AuthShell>
  );
}
