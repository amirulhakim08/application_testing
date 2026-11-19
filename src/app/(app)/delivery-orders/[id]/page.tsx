import Link from "next/link";
import { notFound } from "next/navigation";
import { getContext } from "@/lib/data";
import { getI18n } from "@/lib/i18n/server";
import { getDeliveryOrder } from "@/lib/delivery";
import { getCustomer } from "@/lib/sales";
import { formatDateLabel } from "@/lib/dates";
import { uuid } from "@/lib/validation";
import { PageHeader } from "@/components/app/page-header";
import { Card } from "@/components/ui/card";
import { DeliveryBadge } from "@/components/sales/badges";
import { DeliveryActions } from "@/components/sales/doc-actions";
import { PdfButtons } from "@/components/sales/pdf-buttons";

export default async function DeliveryOrderPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!uuid.safeParse(id).success) notFound();
  const ctx = await getContext();
  const { t, lang } = await getI18n();
  const o = await getDeliveryOrder(ctx, id);
  if (!o) notFound();
  const live = !o.customerSnapshot && o.customerId ? await getCustomer(ctx, o.customerId) : null;
  const name = o.customerSnapshot?.name ?? live?.name ?? null;
  const meta: Array<[string, string | null]> = [
    [t("do.date"), formatDateLabel(o.issueDate, lang)],
    [t("do.deliveredDate"), o.deliveredAt ? formatDateLabel(o.deliveredAt, lang) : null],
    [t("do.receiver"), o.receivedBy],
    [t("do.deliveryNotes"), o.deliveryNotes],
  ];
  return (
    <div className="animate-fade-up">
      <PageHeader
        title={o.number ?? t("c.draft")}
        subtitle={o.status === "draft" ? t("do.draftNumber") : undefined}
        back="/delivery-orders"
        action={<DeliveryBadge status={o.status} t={t} />}
      />
      {o.status === "cancelled" && o.cancelReason && (
        <p className="mb-4 rounded-2xl bg-destructive/10 px-4 py-3 text-sm text-destructive">
          {t("do.status.cancelled")}: {o.cancelReason}
        </p>
      )}
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <DeliveryActions id={o.id} status={o.status} />
        {o.status !== "cancelled" && <PdfButtons kind="delivery-order" id={o.id} defaultTemplate={ctx.settings.documentTemplate} />}
      </div>
      <Card className="overflow-hidden">
        <div className="grid gap-4 border-b bg-muted/30 p-5 sm:grid-cols-2">
          <div className="text-sm">
            <div className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">{t("c.customer")}</div>
            <div className="mt-1 font-semibold">{name ?? "—"}</div>
            <div className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground mt-3">{t("do.address")}</div>
            <div className="mt-1 whitespace-pre-line text-muted-foreground">{o.deliveryAddress ?? "—"}</div>
          </div>
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm sm:justify-self-end">
            {meta
              .filter(([, v]) => v)
              .map(([l, v]) => (
                <div key={l} className="contents">
                  <dt className="text-muted-foreground">{l}</dt>
                  <dd className="text-right font-medium">{v}</dd>
                </div>
              ))}
          </dl>
        </div>
        <table className="w-full text-sm">
          <thead className="bg-muted/40 text-left text-xs text-muted-foreground">
            <tr>
              <th className="w-10 px-5 py-2">#</th>
              <th className="py-2">{t("doc.description")}</th>
              <th className="px-5 py-2 text-right">{t("doc.qty")}</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {o.items.map((i, n) => (
              <tr key={i.position}>
                <td className="px-5 py-3 text-muted-foreground">{n + 1}</td>
                <td className="whitespace-pre-line py-3">{i.description}</td>
                <td className="tabular px-5 py-3 text-right">
                  {i.quantity} {i.unit ?? ""}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {o.notes && <p className="whitespace-pre-line border-t p-5 text-sm text-muted-foreground">{o.notes}</p>}
      </Card>
      <div className="mt-2 flex flex-wrap gap-4 text-sm">
        {o.invoiceId && (
          <Link href={`/invoices/${o.invoiceId}`} className="font-medium text-primary hover:underline">
            {t("do.fromInvoice")} {o.invoiceNumber} →
          </Link>
        )}
        {o.quotationId && (
          <Link href={`/quotations/${o.quotationId}`} className="font-medium text-primary hover:underline">
            {t("do.fromQuote")} {o.quotationNumber} →
          </Link>
        )}
      </div>
    </div>
  );
}
