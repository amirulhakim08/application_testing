import { notFound } from "next/navigation";
import { getContext } from "@/lib/data";
import { getI18n } from "@/lib/i18n/server";
import { getCustomer, getQuotation } from "@/lib/sales";
import { uuid } from "@/lib/validation";
import { PageHeader } from "@/components/app/page-header";
import { QuotationBadge } from "@/components/sales/badges";
import { QuotationActions } from "@/components/sales/doc-actions";
import { DocumentView, dateOrNull } from "@/components/sales/document-view";

export default async function QuotationPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!uuid.safeParse(id).success) notFound();
  const ctx = await getContext();
  const { t, lang } = await getI18n();
  const q = await getQuotation(ctx, id);
  if (!q) notFound();
  // Drafts show the customer's current details; sent/decided quotations show the snapshot taken then.
  const live = !q.customerSnapshot && q.customerId ? await getCustomer(ctx, q.customerId) : null;
  const party = q.customerSnapshot ?? (live ? { name: live.name, company_name: live.companyName, billing_address: live.billingAddress, phone: live.phone, email: live.email } : null);
  return (
    <div className="animate-fade-up">
      <PageHeader title={q.number} subtitle={q.title ?? undefined} back="/quotations" action={<QuotationBadge status={q.displayStatus} t={t} />} />
      <div className="mb-4">
        <QuotationActions id={q.id} status={q.status} convertedInvoiceId={q.convertedInvoiceId} />
      </div>
      <DocumentView
        t={t}
        lang={lang}
        party={party}
        meta={[
          { label: t("qt.issueDate"), value: dateOrNull(q.issueDate, lang) },
          { label: t("qt.validUntil"), value: dateOrNull(q.validUntil, lang) },
        ]}
        items={q.items}
        charges={q.charges}
        totals={q}
        taxLabel={ctx.settings.taxLabel}
        notes={q.notes}
        terms={q.terms}
      />
    </div>
  );
}
