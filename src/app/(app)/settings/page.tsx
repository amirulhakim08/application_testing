import { getContext } from "@/lib/data";
import { getI18n } from "@/lib/i18n/server";
import { PageHeader } from "@/components/app/page-header";
import { SettingsForms } from "@/components/app/settings-forms";
import { BankSettingsForm, BusinessSettingsForm, DocumentSettingsForm } from "@/components/app/business-forms";
import { Card } from "@/components/ui/card";
import { signedLogoUrl } from "@/lib/org-assets";

export const metadata = { title: "Tetapan" };

function Section({ id, title, children }: { id: string; title: string; children: React.ReactNode }) {
  return (
    <section id={id} className="scroll-mt-20">
      <h2 className="mb-2 px-1 text-xs font-medium uppercase tracking-wider text-muted-foreground">{title}</h2>
      <Card className="p-5">{children}</Card>
    </section>
  );
}

export default async function SettingsPage() {
  const ctx = await getContext();
  const { t } = await getI18n();
  const since = new Date(Date.now() - 30 * 24 * 3600_000).toISOString();
  const { data: usage } = await ctx.supabase.from("ai_usage_events").select("kind, success, cached").gte("created_at", since).limit(5000);
  const u = usage ?? [];
  const org = ctx.organization;
  const st = ctx.settings;
  const canEdit = org.role !== "staff";
  const logoUrl = await signedLogoUrl(ctx.supabase, org.logoPath);
  return (
    <div className="mx-auto max-w-2xl animate-fade-up">
      <PageHeader title={t("set.title")} />
      <div className="mb-6 grid gap-6">
        <Section id="syarikat" title={t("set.business")}>
          <BusinessSettingsForm
            canEdit={canEdit}
            logoUrl={logoUrl}
            initial={{
              name: org.name,
              registrationNo: org.registrationNo ?? "",
              address: org.address ?? "",
              email: org.email ?? "",
              phone: org.phone ?? "",
              website: org.website ?? "",
            }}
          />
        </Section>
        <Section id="bank" title={t("set.bank")}>
          <BankSettingsForm
            canEdit={canEdit}
            initial={{ bankName: org.bankName ?? "", bankAccountNo: org.bankAccountNo ?? "", bankAccountHolder: org.bankAccountHolder ?? "" }}
          />
        </Section>
        <Section id="dokumen" title={t("set.documents")}>
          <DocumentSettingsForm
            canEdit={canEdit}
            initial={{
              documentTemplate: st.documentTemplate,
              quotationPrefix: st.quotationPrefix,
              invoicePrefix: st.invoicePrefix,
              deliveryOrderPrefix: st.deliveryOrderPrefix,
              receiptPrefix: st.receiptPrefix,
              paymentTermsDays: st.paymentTermsDays,
              quotationValidityDays: st.quotationValidityDays,
              taxLabel: st.taxLabel,
              defaultTaxRate: st.defaultTaxRate,
              taxRegistrationNo: st.taxRegistrationNo ?? "",
              defaultNotes: st.defaultNotes ?? "",
              defaultTerms: st.defaultTerms ?? "",
            }}
          />
        </Section>
      </div>
      <SettingsForms
        profile={{ fullName: ctx.user.fullName ?? "", email: ctx.user.email }}
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
