import Link from "next/link";
import { notFound } from "next/navigation";
import { getContext } from "@/lib/data";
import { getI18n } from "@/lib/i18n/server";
import { getCustomer, getInvoice } from "@/lib/sales";
import { formatMoney } from "@/lib/money";
import { formatDateLabel } from "@/lib/dates";
import { uuid } from "@/lib/validation";
import { PageHeader } from "@/components/app/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { InvoiceBadges } from "@/components/sales/badges";
import { CreateDeliveryOrderButton, InvoiceActions, ReminderButton, VoidPaymentButton } from "@/components/sales/doc-actions";
import { PdfButtons } from "@/components/sales/pdf-buttons";
import { DocumentView, dateOrNull } from "@/components/sales/document-view";

export default async function InvoicePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!uuid.safeParse(id).success) notFound();
  const ctx = await getContext();
  const { t, lang } = await getI18n();
  const inv = await getInvoice(ctx, id);
  if (!inv) notFound();
  const live = !inv.customerSnapshot && inv.customerId ? await getCustomer(ctx, inv.customerId) : null;
  const party = inv.customerSnapshot ?? (live ? { name: live.name, company_name: live.companyName, billing_address: live.billingAddress, phone: live.phone, email: live.email } : null);

  return (
    <div className="animate-fade-up">
      <PageHeader
        title={inv.number ?? t("c.draft")}
        subtitle={inv.status === "draft" ? t("inv.draftNumber") : undefined}
        back="/invoices"
        action={<InvoiceBadges inv={inv} t={t} />}
      />
      {inv.status === "void" && (
        <p className="mb-4 rounded-2xl bg-destructive/10 px-4 py-3 text-sm text-destructive">
          {t("inv.lifecycle.void")}: {inv.voidReason}
        </p>
      )}

      {inv.status === "issued" && (
        <div className="mb-4 grid grid-cols-3 gap-2 sm:gap-3">
          <Card className="p-3 sm:p-4">
            <div className="text-xs text-muted-foreground">{t("doc.total")}</div>
            <div className="tabular mt-1 text-base font-semibold sm:text-xl">{formatMoney(inv.total)}</div>
          </Card>
          <Card className="p-3 sm:p-4">
            <div className="text-xs text-muted-foreground">{t("inv.paid")}</div>
            <div className="tabular mt-1 text-base font-semibold text-success sm:text-xl">{formatMoney(inv.paid)}</div>
          </Card>
          <Card className="p-3 sm:p-4">
            <div className="text-xs text-muted-foreground">{t("inv.balance")}</div>
            <div className={`tabular mt-1 text-base font-semibold sm:text-xl ${inv.outstanding > 0 ? "text-warning" : ""}`} data-testid="invoice-balance">
              {formatMoney(inv.outstanding)}
            </div>
          </Card>
        </div>
      )}

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <InvoiceActions id={inv.id} status={inv.status} outstandingCents={inv.outstanding} canPay />
        {inv.status === "issued" && inv.outstanding > 0 && inv.number && (
          <ReminderButton number={inv.number} outstandingCents={inv.outstanding} phone={inv.customerPhone} businessName={ctx.organization.name} />
        )}
        {inv.status === "issued" && <CreateDeliveryOrderButton source="invoice" id={inv.id} />}
        {inv.status !== "void" && <PdfButtons kind="invoice" id={inv.id} defaultTemplate={ctx.settings.documentTemplate} />}
      </div>

      <DocumentView
        t={t}
        lang={lang}
        party={party}
        meta={[
          { label: t("inv.date"), value: dateOrNull(inv.invoiceDate, lang) },
          { label: t("inv.due"), value: dateOrNull(inv.dueDate, lang) },
          { label: t("inv.po"), value: inv.customerPo },
          { label: t("inv.paymentTerms"), value: inv.paymentTerms },
          { label: t("inv.fromQuote"), value: inv.quotationNumber },
        ]}
        items={inv.items}
        charges={inv.charges}
        totals={inv}
        taxLabel={ctx.settings.taxLabel}
        notes={inv.notes}
        terms={inv.terms}
      />
      {inv.quotationId && (
        <p className="mt-2 text-sm">
          <Link href={`/quotations/${inv.quotationId}`} className="font-medium text-primary hover:underline">
            {t("inv.fromQuote")} {inv.quotationNumber} →
          </Link>
        </p>
      )}

      {inv.status !== "draft" && (
        <Card className="mt-4">
          <CardHeader>
            <CardTitle>{t("inv.payments")}</CardTitle>
          </CardHeader>
          <CardContent className="divide-y p-2">
            {inv.payments.length === 0 && <p className="p-4 text-sm text-muted-foreground">{t("inv.noPayments")}</p>}
            {inv.payments.map((p) => (
              <div key={p.id} className={`flex flex-wrap items-center gap-3 px-3 py-3 ${p.voided ? "opacity-60" : ""}`}>
                <span className="min-w-0 flex-1 basis-48">
                  <span className="block font-medium">
                    <span className="whitespace-nowrap">{p.receiptNumber}</span> {p.voided && <span className="text-xs text-destructive">({t("pay.voided")}: {p.voidReason})</span>}
                  </span>
                  <span className="block text-xs text-muted-foreground">
                    {formatDateLabel(p.date, lang)} · {t(`pay.m.${p.method}` as "pay.m.cash")}
                    {p.reference ? ` · ${p.reference}` : ""}
                  </span>
                </span>
                <span className={`tabular font-semibold ${p.voided ? "line-through" : ""}`}>{formatMoney(p.amount)}</span>
                {p.receiptNumber && <PdfButtons compact kind="receipt" id={p.id} label={p.receiptNumber} defaultTemplate={ctx.settings.documentTemplate} />}
                {!p.voided && <VoidPaymentButton id={p.id} />}
              </div>
            ))}
          </CardContent>
        </Card>
      )}
      <p className="mt-4 text-center text-xs text-muted-foreground">{t("inv.notEinvoice")}</p>
    </div>
  );
}
