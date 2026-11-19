import Link from "next/link";
import { notFound } from "next/navigation";
import { FilePlus2, ReceiptText } from "lucide-react";
import { getContext } from "@/lib/data";
import { getI18n } from "@/lib/i18n/server";
import { customerSummary, getCustomer } from "@/lib/sales";
import { formatMoney } from "@/lib/money";
import { formatDateLabel } from "@/lib/dates";
import { uuid } from "@/lib/validation";
import { PageHeader } from "@/components/app/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { buttonVariants } from "@/components/ui/button";
import { CustomerDialog } from "@/components/sales/customer-form";
import { ArchiveCustomerButton } from "@/components/sales/doc-actions";
import { InvoiceBadges, QuotationBadge } from "@/components/sales/badges";

export default async function CustomerPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!uuid.safeParse(id).success) notFound();
  const ctx = await getContext();
  const { t, lang } = await getI18n();
  const c = await getCustomer(ctx, id);
  if (!c) notFound();
  const s = await customerSummary(ctx, id);
  const stat = (label: string, value: number, tone = "") => (
    <Card className="p-4">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className={`tabular mt-1 text-xl font-semibold ${tone}`}>{formatMoney(value)}</div>
    </Card>
  );
  return (
    <div className="animate-fade-up">
      <PageHeader
        title={c.name}
        subtitle={[c.companyName, c.phone, c.email].filter(Boolean).join(" · ")}
        back="/customers"
        action={
          <div className="flex gap-2">
            <CustomerDialog trigger="edit" initial={c} />
          </div>
        }
      />
      <div className="grid gap-3 sm:grid-cols-3">
        {stat(t("cus.invoiced"), s.totalInvoiced)}
        {stat(t("cus.received"), s.totalReceived, "text-success")}
        {stat(t("cus.outstanding"), s.outstanding, s.outstanding > 0 ? "text-warning" : "")}
      </div>
      <div className="mt-4 flex flex-wrap gap-2">
        <Link href={`/quotations/new?customer=${c.id}`} className={buttonVariants({ variant: "outline" })}>
          <FilePlus2 /> {t("qt.new")}
        </Link>
        <Link href={`/invoices/new?customer=${c.id}`} className={buttonVariants({ variant: "outline" })}>
          <ReceiptText /> {t("inv.new")}
        </Link>
        <ArchiveCustomerButton id={c.id} archived={c.archived} />
      </div>
      {(c.billingAddress || c.deliveryAddress || c.notes) && (
        <Card className="mt-4 grid gap-3 p-5 text-sm sm:grid-cols-3">
          {c.billingAddress && (
            <div>
              <div className="text-xs text-muted-foreground">{t("cus.billing")}</div>
              <div className="whitespace-pre-line">{c.billingAddress}</div>
            </div>
          )}
          {c.deliveryAddress && (
            <div>
              <div className="text-xs text-muted-foreground">{t("cus.delivery")}</div>
              <div className="whitespace-pre-line">{c.deliveryAddress}</div>
            </div>
          )}
          {c.notes && (
            <div>
              <div className="text-xs text-muted-foreground">{t("c.notes")}</div>
              <div className="whitespace-pre-line">{c.notes}</div>
            </div>
          )}
        </Card>
      )}

      <div className="mt-6 grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>{t("inv.title")}</CardTitle>
          </CardHeader>
          <CardContent className="divide-y p-2">
            {s.invoices.length === 0 && <p className="p-4 text-sm text-muted-foreground">{t("c.none")}</p>}
            {s.invoices.map((i) => (
              <Link key={i.id} href={`/invoices/${i.id}`} className="flex items-center gap-3 rounded-xl px-3 py-2.5 hover:bg-muted/60">
                <span className="min-w-0 flex-1">
                  <span className="block font-medium">{i.number ?? t("c.draft")}</span>
                  <span className="block text-xs text-muted-foreground">{formatDateLabel(i.invoiceDate, lang)}</span>
                </span>
                <InvoiceBadges inv={i} t={t} />
                <span className="tabular w-28 text-right text-sm font-semibold">{formatMoney(i.total)}</span>
              </Link>
            ))}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>{t("qt.title")}</CardTitle>
          </CardHeader>
          <CardContent className="divide-y p-2">
            {s.quotations.length === 0 && <p className="p-4 text-sm text-muted-foreground">{t("c.none")}</p>}
            {s.quotations.map((q) => (
              <Link key={q.id} href={`/quotations/${q.id}`} className="flex items-center gap-3 rounded-xl px-3 py-2.5 hover:bg-muted/60">
                <span className="min-w-0 flex-1">
                  <span className="block font-medium">{q.number}</span>
                  <span className="block text-xs text-muted-foreground">{formatDateLabel(q.issueDate, lang)}</span>
                </span>
                <QuotationBadge status={q.displayStatus} t={t} />
                <span className="tabular w-28 text-right text-sm font-semibold">{formatMoney(q.total)}</span>
              </Link>
            ))}
          </CardContent>
        </Card>
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>{t("inv.payments")}</CardTitle>
          </CardHeader>
          <CardContent className="divide-y p-2">
            {s.payments.length === 0 && <p className="p-4 text-sm text-muted-foreground">{t("inv.noPayments")}</p>}
            {s.payments.map((p) => (
              <div key={p.id} className={`flex items-center gap-3 px-3 py-2.5 ${p.voided ? "opacity-60" : ""}`}>
                <span className="min-w-0 flex-1">
                  <span className="block font-medium">
                    {p.receiptNumber ?? "—"} {p.voided && <span className="text-xs text-destructive">({t("pay.voided")})</span>}
                  </span>
                  <span className="block text-xs text-muted-foreground">
                    {formatDateLabel(p.date, lang)} · {t(`pay.m.${p.method}` as "pay.m.cash")} {p.invoiceNumber ? `· ${p.invoiceNumber}` : ""}
                  </span>
                </span>
                <span className={`tabular text-sm font-semibold ${p.voided ? "line-through" : ""}`}>{formatMoney(p.amount)}</span>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
