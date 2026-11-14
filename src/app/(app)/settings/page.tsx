import { getContext } from "@/lib/data";
import { getI18n } from "@/lib/i18n/server";
import { PageHeader } from "@/components/app/page-header";
import { SettingsForms } from "@/components/app/settings-forms";

export const metadata = { title: "Settings" };

export default async function SettingsPage() {
  const ctx = await getContext();
  const { t } = await getI18n();
  const since = new Date(Date.now() - 30 * 24 * 3600_000).toISOString();
  const { data: usage } = await ctx.supabase.from("ai_usage_events").select("kind, success, cached").gte("created_at", since).limit(5000);
  const u = usage ?? [];
  return (
    <div className="mx-auto max-w-2xl animate-fade-up">
      <PageHeader title={t("set.title")} />
      <SettingsForms
        profile={{ fullName: ctx.user.fullName ?? "", email: ctx.user.email, companyName: ctx.company.name }}
        prefs={{ language: ctx.preferences.language, theme: ctx.preferences.theme, receiptRetention: ctx.preferences.receiptRetention, currency: ctx.preferences.currency }}
        usage={{
          scans: u.filter((x) => x.kind === "receipt_scan" && x.success).length,
          transcriptions: u.filter((x) => x.kind === "transcription" && x.success).length,
          errors: u.filter((x) => !x.success).length,
        }}
      />
    </div>
  );
}
