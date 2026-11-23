import Link from "next/link";
import { Paperclip } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { notFound } from "next/navigation";
import { getContext } from "@/lib/data";
import { getI18n } from "@/lib/i18n/server";
import { getCustomer, getPayment } from "@/lib/sales";
import { formatMoney } from "@/lib/money";
import { formatDateLabel } from "@/lib/dates";
import { uuid } from "@/lib/validation";
import { PageHeader } from "@/components/app/page-header";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { ReceiptFixActions, VoidPaymentButton } from "@/components/sales/doc-actions";
import { DocumentView } from "@/components/sales/document-view";
import { PdfButtons } from "@/components/sales/pdf-buttons";

/** One receipt. The id is the payment id (every receipt belongs to exactly one payment). */
export default async function ReceiptPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!uuid.safeParse(id).success) notFound();
  const ctx = await getContext();
  const { t, lang } = await getI18n();
  const p = await getPayment(ctx, id);
  if (!p || !p.receiptNumber) notFound();
  const live = p.customerId ? await getCustomer(ctx, p.customerId) : null;
  const party = p.sale?.customerSnapshot ?? (live ? { name: live.name, company_name: live.companyName, billing_address: live.billingAddress, phone: live.phone, email: live.email } : null);
  const meta = [
    { label: t("pay.date"), value: formatDateLabel(p.date, lang) },
    { label: t("pay.method"), value: t(`pay.m.${p.method}` as "pay.m.cash") },
    { label: t("pay.reference"), value: p.reference },
  ];
  return (
    <div className="animate-fade-up">
      <PageHeader
        title={p.receiptNumber}
        subtitle={p.sale ? t("sale.badge") : undefined}
        back="/receipts"
        action={p.voided ? <Badge variant="danger">{t("pay.voided")}</Badge> : <Badge variant="success">{t("inv.pay.paid")}</Badge>}
      />
      {p.voided && p.voidReason && (
        <p className="mb-4 rounded-2xl bg-destructive/10 px-4 py-3 text-sm text-destructive">
          {t("pay.voided")}: {p.voidReason}
        </p>
      )}
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <PdfButtons kind="receipt" id={p.id} defaultTemplate={ctx.settings.documentTemplate} />
        {p.hasProof && (
          <a href={`/api/payments/${p.id}/proof`} target="_blank" rel="noopener" className={buttonVariants({ variant: "outline" })}>
            <Paperclip /> {t("proof.view")}
          </a>
        )}
        <ReceiptFixActions
          id={p.id}
          number={p.receiptNumber}
          canCorrect={Boolean(p.sale) && !p.voided}
          canDelete={ctx.organization.role !== "staff" && Date.now() - new Date(p.createdAt).getTime() < 24 * 3600 * 1000}
        />
        {!p.voided && <VoidPaymentButton id={p.id} />}
      </div>
      {p.sale ? (
        <DocumentView
          t={t}
          lang={lang}
          party={party ?? { name: t("sale.walkIn") }}
          meta={meta}
          items={p.sale.items}
          charges={p.sale.charges}
          totals={p.sale}
          taxLabel={ctx.settings.taxLabel}
          notes={p.sale.notes}
          terms={null}
        />
      ) : (
        <Card className="grid gap-3 p-5 text-sm">
          <div className="flex justify-between gap-4">
            <span className="text-muted-foreground">{t("rc.paymentFor")}</span>
            <span className="text-right font-medium">
              {p.invoiceId ? (
                <Link href={`/invoices/${p.invoiceId}`} className="text-primary hover:underline">
                  {p.invoiceNumber}
                </Link>
              ) : (
                (p.description ?? t("pay.standalone"))
              )}
            </span>
          </div>
          {party?.name && (
            <div className="flex justify-between gap-4">
              <span className="text-muted-foreground">{t("c.customer")}</span>
              <span className="font-medium">{party.name}</span>
            </div>
          )}
          {meta
            .filter((m) => m.value)
            .map((m) => (
              <div key={m.label} className="flex justify-between gap-4">
                <span className="text-muted-foreground">{m.label}</span>
                <span className="font-medium">{m.value}</span>
              </div>
            ))}
          <div className="flex items-baseline justify-between border-t pt-3">
            <span className="font-semibold">{t("pay.amount")}</span>
            <span className={`tabular text-2xl font-semibold ${p.voided ? "line-through" : ""}`}>{formatMoney(p.amount)}</span>
          </div>
        </Card>
      )}
    </div>
  );
}
