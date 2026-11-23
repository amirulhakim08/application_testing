import { notFound } from "next/navigation";
import { getContext } from "@/lib/data";
import { getI18n } from "@/lib/i18n/server";
import { getInvoice, getPayment, getQuotation } from "@/lib/sales";
import { getDeliveryOrder } from "@/lib/delivery";
import { uuid } from "@/lib/validation";
import { PdfViewer } from "@/components/sales/pdf-viewer";

export const metadata = { title: "PDF" };

/** In-app PDF view with Back / Share / Download (receipt id = payment id). */
export default async function DocumentPdfPage({ params, searchParams }: { params: Promise<{ kind: string; id: string }>; searchParams: Promise<{ template?: string }> }) {
  const { kind, id } = await params;
  const { template } = await searchParams;
  if (!uuid.safeParse(id).success) notFound();
  const ctx = await getContext();
  const { t } = await getI18n();
  let number: string | null = null;
  let backHref = "/";
  if (kind === "quotation") {
    number = (await getQuotation(ctx, id))?.number ?? null;
    backHref = `/quotations/${id}`;
  } else if (kind === "invoice") {
    const inv = await getInvoice(ctx, id);
    number = inv ? (inv.number ?? t("c.draft")) : null;
    backHref = `/invoices/${id}`;
  } else if (kind === "receipt") {
    number = (await getPayment(ctx, id))?.receiptNumber ?? null;
    backHref = `/receipts/${id}`;
  } else if (kind === "delivery-order") {
    const o = await getDeliveryOrder(ctx, id);
    number = o ? (o.number ?? t("c.draft")) : null;
    backHref = `/delivery-orders/${id}`;
  }
  if (!number) notFound();
  return (
    <PdfViewer
      kind={kind as "quotation"}
      id={id}
      number={number}
      businessName={ctx.organization.name}
      defaultTemplate={template ?? ctx.settings.documentTemplate}
      backHref={backHref}
    />
  );
}
