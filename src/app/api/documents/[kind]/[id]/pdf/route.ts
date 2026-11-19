import { getContext } from "@/lib/data";
import { getCustomer, getInvoice, getPayment, getQuotation, type PartySnapshot } from "@/lib/sales";
import { getDeliveryOrder } from "@/lib/delivery";
import { deliveryOrderPdf, invoicePdf, pdfFilename, pickTemplate, quotationPdf, receiptPdf, renderPdf } from "@/lib/pdf/build";
import { uuid } from "@/lib/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function liveParty(ctx: Awaited<ReturnType<typeof getContext>>, customerId: string | null): Promise<PartySnapshot | null> {
  if (!customerId) return null;
  const c = await getCustomer(ctx, customerId);
  return c ? { name: c.name, company_name: c.companyName, billing_address: c.billingAddress, delivery_address: c.deliveryAddress, phone: c.phone, email: c.email } : null;
}

/**
 * Renders a business document as PDF on demand (never stored, never public).
 * Access is the caller's own: every read goes through RLS with the user's session.
 *   ?template=classic|modern|navy   (default: business setting)
 *   ?download=1                     (attachment instead of inline viewing/printing)
 */
export async function GET(req: Request, { params }: { params: Promise<{ kind: string; id: string }> }) {
  const { kind, id } = await params;
  if (!uuid.safeParse(id).success) return new Response("Not found", { status: 404 });
  const ctx = await getContext();
  const url = new URL(req.url);
  const lang = ctx.preferences.language;
  const template = pickTemplate(url.searchParams.get("template"), ctx.settings.documentTemplate);

  let data;
  let name: string;
  if (kind === "quotation") {
    const q = await getQuotation(ctx, id);
    if (!q) return new Response("Not found", { status: 404 });
    data = await quotationPdf(ctx, q, q.customerSnapshot ? null : await liveParty(ctx, q.customerId), lang, template);
    name = pdfFilename("SebutHarga", q.number);
  } else if (kind === "invoice") {
    const inv = await getInvoice(ctx, id);
    if (!inv) return new Response("Not found", { status: 404 });
    data = await invoicePdf(ctx, inv, inv.customerSnapshot ? null : await liveParty(ctx, inv.customerId), lang, template);
    name = pdfFilename("Invois", inv.number ?? "Draf");
  } else if (kind === "receipt") {
    const p = await getPayment(ctx, id);
    if (!p || !p.receiptNumber) return new Response("Not found", { status: 404 });
    const inv = p.invoiceId ? await getInvoice(ctx, p.invoiceId) : null;
    const customer = inv?.customerSnapshot ?? (await liveParty(ctx, p.customerId));
    data = await receiptPdf(ctx, p, customer, inv ? { total: inv.total, outstanding: inv.outstanding } : null, lang, template);
    name = pdfFilename("Resit", p.receiptNumber);
  } else if (kind === "delivery-order") {
    const o = await getDeliveryOrder(ctx, id);
    if (!o) return new Response("Not found", { status: 404 });
    data = await deliveryOrderPdf(ctx, o, o.customerSnapshot ? null : await liveParty(ctx, o.customerId), lang, template);
    name = pdfFilename("DO", o.number ?? "Draf");
  } else {
    return new Response("Not found", { status: 404 });
  }

  const pdf = await renderPdf(data);
  return new Response(new Uint8Array(pdf), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `${url.searchParams.get("download") ? "attachment" : "inline"}; filename="${name}"`,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
