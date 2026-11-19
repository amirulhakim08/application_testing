import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getBaseContext } from "@/lib/data";
import { signedLogoUrl } from "@/lib/org-assets";
import { Logo } from "@/components/app/logo";
import { LanguageToggle } from "@/components/app/auth-forms";
import { OnboardingWizard } from "@/components/app/onboarding-wizard";

export const metadata: Metadata = { title: "Sediakan perniagaan" };

export default async function OnboardingPage() {
  const ctx = await getBaseContext();
  const org = ctx.organization;
  const s = ctx.settings;
  if (org && (s.onboardingCompleted || org.role === "staff")) redirect("/");
  const logoUrl = org ? await signedLogoUrl(ctx.supabase, org.logoPath) : null;

  return (
    <div className="min-h-dvh">
      <header className="flex items-center justify-between px-5 pb-2 pt-[max(1rem,env(safe-area-inset-top))] sm:px-10">
        <Logo />
        <LanguageToggle />
      </header>
      <main className="px-4 pb-16 pt-6 sm:px-6">
        <OnboardingWizard
          hasOrganization={Boolean(org)}
          initialStep={org ? 1 : 0}
          logoUrl={logoUrl}
          business={{
            name: org?.name ?? "",
            registrationNo: org?.registrationNo ?? "",
            address: org?.address ?? "",
            email: org?.email ?? ctx.user.email ?? "",
            phone: org?.phone ?? "",
            website: org?.website ?? "",
          }}
          bank={{ bankName: org?.bankName ?? "", bankAccountNo: org?.bankAccountNo ?? "", bankAccountHolder: org?.bankAccountHolder ?? org?.name ?? "" }}
          documents={{
            documentTemplate: s.documentTemplate,
            quotationPrefix: s.quotationPrefix,
            invoicePrefix: s.invoicePrefix,
            deliveryOrderPrefix: s.deliveryOrderPrefix,
            receiptPrefix: s.receiptPrefix,
            paymentTermsDays: s.paymentTermsDays,
            quotationValidityDays: s.quotationValidityDays,
            taxLabel: s.taxLabel,
            defaultTaxRate: s.defaultTaxRate,
          }}
        />
      </main>
    </div>
  );
}
