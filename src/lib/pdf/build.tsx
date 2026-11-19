import "server-only";
import { renderToBuffer } from "@react-pdf/renderer";
import type { AppContext } from "@/lib/data";
import { formatDateLabel } from "@/lib/dates";
import { formatMoney } from "@/lib/money";
import { ORG_ASSETS_BUCKET } from "@/lib/org-assets";
import type { Invoice, PartySnapshot, Quotation } from "@/lib/sales";
import type { DeliveryOrder } from "@/lib/delivery";
import { BusinessDocument, type PdfDocumentData, type PdfParty, type TemplateName } from "./document";
import { amountInWords } from "./words";

type Lang = "ms" | "en";

const L = {
  ms: {
    quotation: "SEBUT HARGA",
    invoice: "INVOIS",
    receipt: "RESIT",
    deliveryOrder: "DELIVERY ORDER",
    to: "Kepada",
    billTo: "Dibilkan kepada",
    deliverTo: "Hantar kepada",
    receivedFrom: "Diterima daripada",
    date: "Tarikh",
    validUntil: "Sah sehingga",
    due: "Tarikh akhir bayaran",
    po: "No. PO",
    terms: "Terma bayaran",
    ref: "Rujukan",
    quote: "Sebut harga",
    invoiceRef: "Invois",
    no: "No.",
    description: "Perkara",
    qty: "Kuantiti",
    price: "Harga (RM)",
    tax: "Cukai",
    amount: "Jumlah (RM)",
    subtotal: "Jumlah kecil",
    discount: "Diskaun",
    total: "JUMLAH",
    taxTotal: "Cukai",
    paid: "Dibayar",
    balance: "Baki",
    notes: "Nota",
    tnc: "Terma & syarat",
    bank: "Cara bayaran",
    amountReceived: "Jumlah diterima",
    method: "Cara bayaran",
    paymentFor: "Bayaran untuk",
    prepared: "Disediakan oleh",
    accepted: "Diterima oleh (cop & tandatangan)",
    receivedBy: "Diterima oleh",
    deliveredBy: "Dihantar oleh",
    delivered: "Tarikh terima",
    draft: "DRAF",
    void: "BATAL",
    cancelled: "DIBATALKAN",
    footer: "Dokumen janaan komputer oleh BukuTigaLima. Bukan e-Invois LHDN.",
    page: (p: number, t: number) => `Muka ${p} / ${t}`,
    methods: { cash: "Tunai", bank_transfer: "Pindahan bank", duitnow: "DuitNow / QR", card: "Kad", cheque: "Cek", ewallet: "E-dompet", other: "Lain-lain" } as Record<string, string>,
    reg: "No. SSM",
    taxReg: "No. pendaftaran",
    account: "No. akaun",
    holder: "Nama akaun",
    quoteNumber: "Rujuk",
  },
  en: {
    quotation: "QUOTATION",
    invoice: "INVOICE",
    receipt: "RECEIPT",
    deliveryOrder: "DELIVERY ORDER",
    to: "To",
    billTo: "Bill to",
    deliverTo: "Deliver to",
    receivedFrom: "Received from",
    date: "Date",
    validUntil: "Valid until",
    due: "Due date",
    po: "PO no.",
    terms: "Payment terms",
    ref: "Reference",
    quote: "Quotation",
    invoiceRef: "Invoice",
    no: "No.",
    description: "Description",
    qty: "Qty",
    price: "Price (RM)",
    tax: "Tax",
    amount: "Amount (RM)",
    subtotal: "Subtotal",
    discount: "Discount",
    total: "TOTAL",
    taxTotal: "Tax",
    paid: "Paid",
    balance: "Balance",
    notes: "Notes",
    tnc: "Terms & conditions",
    bank: "Payment details",
    amountReceived: "Amount received",
    method: "Payment method",
    paymentFor: "Payment for",
    prepared: "Prepared by",
    accepted: "Accepted by (stamp & signature)",
    receivedBy: "Received by",
    deliveredBy: "Delivered by",
    delivered: "Received on",
    draft: "DRAFT",
    void: "VOID",
    cancelled: "CANCELLED",
    footer: "Computer-generated document by BukuTigaLima. Not an LHDN e-Invoice.",
    page: (p: number, t: number) => `Page ${p} / ${t}`,
    methods: { cash: "Cash", bank_transfer: "Bank transfer", duitnow: "DuitNow / QR", card: "Card", cheque: "Cheque", ewallet: "E-wallet", other: "Other" } as Record<string, string>,
    reg: "Reg. no.",
    taxReg: "Tax reg. no.",
    account: "Account no.",
    holder: "Account name",
    quoteNumber: "Ref",
  },
};

interface CompanyInfo {
  name: string;
  registrationNo?: string | null;
  address?: string | null;
  phone?: string | null;
  email?: string | null;
  website?: string | null;
  logoPath?: string | null;
  bankName?: string | null;
  bankAccountNo?: string | null;
  bankAccountHolder?: string | null;
  taxLabel?: string | null;
  taxRegistrationNo?: string | null;
}

function liveCompany(ctx: AppContext): CompanyInfo {
  const o = ctx.organization;
  return {
    name: o.name,
    registrationNo: o.registrationNo,
    address: o.address,
    phone: o.phone,
    email: o.email,
    website: o.website,
    logoPath: o.logoPath,
    bankName: o.bankName,
    bankAccountNo: o.bankAccountNo,
    bankAccountHolder: o.bankAccountHolder,
    taxLabel: ctx.settings.taxLabel,
    taxRegistrationNo: ctx.settings.taxRegistrationNo,
  };
}

/** Issued invoices keep the company details captured at issue time. */
function snapshotCompany(snap: Record<string, string | null> | null, fallback: CompanyInfo): CompanyInfo {
  if (!snap) return fallback;
  return {
    name: snap.name ?? fallback.name,
    registrationNo: snap.registration_no,
    address: snap.address,
    phone: snap.phone,
    email: snap.email,
    website: snap.website,
    logoPath: snap.logo_path ?? fallback.logoPath,
    bankName: snap.bank_name,
    bankAccountNo: snap.bank_account_no,
    bankAccountHolder: snap.bank_account_holder,
    taxLabel: snap.tax_label ?? fallback.taxLabel,
    taxRegistrationNo: snap.tax_registration_no,
  };
}

async function logoDataUri(ctx: AppContext, path: string | null | undefined): Promise<string | null> {
  if (!path) return null;
  const { data } = await ctx.supabase.storage.from(ORG_ASSETS_BUCKET).download(path);
  if (!data) return null;
  const buf = Buffer.from(await data.arrayBuffer());
  return `data:image/png;base64,${buf.toString("base64")}`;
}

async function companyBlock(ctx: AppContext, c: CompanyInfo, lang: Lang) {
  const t = L[lang];
  const lines = [
    c.registrationNo ? `${t.reg}: ${c.registrationNo}` : null,
    ...(c.address ? c.address.split("\n") : []),
    [c.phone, c.email].filter(Boolean).join(" · ") || null,
    c.website ?? null,
    c.taxRegistrationNo ? `${c.taxLabel ?? "SST"} ${t.taxReg}: ${c.taxRegistrationNo}` : null,
  ].filter((x): x is string => Boolean(x));
  return { name: c.name, lines, logo: await logoDataUri(ctx, c.logoPath) };
}

function partyFrom(label: string, snap: PartySnapshot | null, fallbackName: string | null, addressOverride?: string | null): PdfParty {
  const lines = [
    snap?.company_name ?? null,
    ...((addressOverride ?? snap?.billing_address ?? "").split("\n").filter(Boolean)),
    [snap?.phone, snap?.email].filter(Boolean).join(" · ") || null,
  ].filter((x): x is string => Boolean(x));
  return { label, name: snap?.name ?? fallbackName ?? "—", lines };
}

const d = (iso: string | null | undefined, lang: Lang) => (iso ? formatDateLabel(iso, lang, { day: "numeric", month: "short", year: "numeric" }) : "");
const money = (c: number) => formatMoney(c);
const plain = (c: number) => (c / 100).toLocaleString("en-MY", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

function docItems(items: Quotation["items"]) {
  return items.map((i) => ({
    no: i.position,
    description: i.description,
    qty: i.quantity,
    unit: i.unit,
    price: Number(i.unitPrice).toLocaleString("en-MY", { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
    tax: Number(i.taxRate) > 0 ? `${i.taxRate}%` : "—",
    amount: plain(i.lineSubtotal),
    note: Number(i.discount) > 0 ? `- ${Number(i.discount).toFixed(2)}` : undefined,
  }));
}

function docTotals(doc: Pick<Quotation, "subtotal" | "discountTotal" | "taxTotal" | "total" | "charges">, taxLabel: string, lang: Lang) {
  const t = L[lang];
  const rows: Array<{ label: string; value: string; strong?: boolean }> = [{ label: t.subtotal, value: money(doc.subtotal) }];
  if (doc.discountTotal > 0) rows.push({ label: t.discount, value: `- ${money(doc.discountTotal)}` });
  for (const c of doc.charges) rows.push({ label: `${c.label}${c.kind === "percent" ? ` (${Number(c.value)}%)` : ""}`, value: money(c.amount) });
  rows.push({ label: `${t.taxTotal} (${taxLabel})`, value: money(doc.taxTotal) });
  rows.push({ label: t.total, value: money(doc.total), strong: true });
  return rows;
}

function columns(lang: Lang, taxLabel: string, prices = true) {
  const t = L[lang];
  return prices
    ? { no: t.no, description: t.description, qty: t.qty, price: t.price, tax: taxLabel, amount: t.amount }
    : { no: t.no, description: t.description, qty: t.qty };
}

export function pickTemplate(requested: string | null | undefined, fallback: TemplateName): TemplateName {
  return requested === "classic" || requested === "modern" || requested === "navy" ? requested : fallback;
}

export async function quotationPdf(ctx: AppContext, q: Quotation, live: PartySnapshot | null, lang: Lang, template: TemplateName): Promise<PdfDocumentData> {
  const t = L[lang];
  const taxLabel = ctx.settings.taxLabel;
  const sections = [q.title ? { title: t.description, body: q.title } : null, q.notes ? { title: t.notes, body: q.notes } : null, q.terms ? { title: t.tnc, body: q.terms } : null].filter(
    (x): x is { title: string; body: string } => Boolean(x),
  );
  return {
    template,
    title: t.quotation,
    number: q.number,
    watermark: q.status === "draft" ? t.draft : null,
    company: await companyBlock(ctx, liveCompany(ctx), lang),
    party: partyFrom(t.to, q.customerSnapshot ?? live, q.customerName),
    meta: [
      { label: t.date, value: d(q.issueDate, lang) },
      ...(q.validUntil ? [{ label: t.validUntil, value: d(q.validUntil, lang) }] : []),
    ],
    columns: columns(lang, taxLabel),
    items: docItems(q.items),
    totals: docTotals(q, taxLabel, lang),
    amountInWords: amountInWords(q.total, lang),
    sections,
    signatures: [t.prepared, t.accepted],
    footer: t.footer,
    pageLabel: t.page,
  };
}

export async function invoicePdf(ctx: AppContext, inv: Invoice, live: PartySnapshot | null, lang: Lang, template: TemplateName): Promise<PdfDocumentData> {
  const t = L[lang];
  const company = inv.status === "draft" ? liveCompany(ctx) : snapshotCompany(await companySnapshot(ctx, inv.id), liveCompany(ctx));
  const taxLabel = company.taxLabel ?? ctx.settings.taxLabel;
  const totals = docTotals(inv, taxLabel, lang);
  if (inv.status === "issued" && inv.paid > 0) {
    totals.push({ label: t.paid, value: `- ${money(inv.paid)}` });
    totals.push({ label: t.balance, value: money(inv.outstanding), strong: true });
  }
  const bankLines = [
    company.bankName,
    company.bankAccountNo ? `${t.account}: ${company.bankAccountNo}` : null,
    company.bankAccountHolder ? `${t.holder}: ${company.bankAccountHolder}` : null,
    inv.number ? `${t.ref}: ${inv.number}` : null,
  ].filter(Boolean);
  const sections = [
    company.bankName || company.bankAccountNo ? { title: t.bank, body: bankLines.join("\n") } : null,
    inv.notes ? { title: t.notes, body: inv.notes } : null,
    inv.terms ? { title: t.tnc, body: inv.terms } : null,
  ].filter((x): x is { title: string; body: string } => Boolean(x));
  return {
    template,
    title: t.invoice,
    number: inv.number ?? t.draft,
    watermark: inv.status === "draft" ? t.draft : inv.status === "void" ? t.void : null,
    company: await companyBlock(ctx, company, lang),
    party: partyFrom(t.billTo, inv.customerSnapshot ?? live, inv.customerName),
    meta: [
      { label: t.date, value: d(inv.invoiceDate, lang) },
      ...(inv.dueDate ? [{ label: t.due, value: d(inv.dueDate, lang) }] : []),
      ...(inv.paymentTerms ? [{ label: t.terms, value: inv.paymentTerms }] : []),
      ...(inv.customerPo ? [{ label: t.po, value: inv.customerPo }] : []),
      ...(inv.quotationNumber ? [{ label: t.quote, value: inv.quotationNumber }] : []),
    ],
    columns: columns(lang, taxLabel),
    items: docItems(inv.items),
    totals,
    amountInWords: amountInWords(inv.total, lang),
    sections,
    footer: t.footer,
    pageLabel: t.page,
  };
}

async function companySnapshot(ctx: AppContext, invoiceId: string) {
  const { data } = await ctx.supabase.from("invoices").select("company_snapshot").eq("id", invoiceId).maybeSingle();
  return (data?.company_snapshot as Record<string, string | null>) ?? null;
}

export async function receiptPdf(
  ctx: AppContext,
  p: { receiptNumber: string | null; amount: number; date: string; method: string; reference: string | null; description: string | null; voided: boolean; invoiceNumber: string | null },
  customer: PartySnapshot | null,
  invoice: { total: number; outstanding: number } | null,
  lang: Lang,
  template: TemplateName,
): Promise<PdfDocumentData> {
  const t = L[lang];
  return {
    template,
    title: t.receipt,
    number: p.receiptNumber ?? "—",
    watermark: p.voided ? t.void : null,
    company: await companyBlock(ctx, liveCompany(ctx), lang),
    party: partyFrom(t.receivedFrom, customer, customer?.name ?? "—"),
    meta: [
      { label: t.date, value: d(p.date, lang) },
      { label: t.method, value: t.methods[p.method] ?? p.method },
      ...(p.reference ? [{ label: t.ref, value: p.reference }] : []),
      ...(p.invoiceNumber ? [{ label: t.invoiceRef, value: p.invoiceNumber }] : []),
    ],
    columns: { no: t.no, description: t.paymentFor, qty: "", amount: t.amount },
    items: [
      {
        no: 1,
        description: p.invoiceNumber ? `${t.invoiceRef} ${p.invoiceNumber}` : (p.description ?? "—"),
        qty: "",
        amount: plain(p.amount),
      },
    ],
    totals: invoice
      ? [
          { label: `${t.invoiceRef} ${t.total.toLowerCase()}`, value: money(invoice.total) },
          { label: t.amountReceived, value: money(p.amount), strong: true },
          { label: `${t.balance}`, value: money(invoice.outstanding) },
        ]
      : [{ label: t.amountReceived, value: money(p.amount), strong: true }],
    amountInWords: amountInWords(p.amount, lang),
    signatures: [t.receivedBy],
    footer: t.footer,
    pageLabel: t.page,
  };
}

export async function deliveryOrderPdf(ctx: AppContext, o: DeliveryOrder, live: PartySnapshot | null, lang: Lang, template: TemplateName): Promise<PdfDocumentData> {
  const t = L[lang];
  const party = partyFrom(t.deliverTo, o.customerSnapshot ?? live, o.customerName, o.deliveryAddress);
  return {
    template,
    title: t.deliveryOrder,
    number: o.number ?? t.draft,
    watermark: o.status === "draft" ? t.draft : o.status === "cancelled" ? t.cancelled : null,
    company: await companyBlock(ctx, liveCompany(ctx), lang),
    party,
    meta: [
      { label: t.date, value: d(o.issueDate, lang) },
      ...(o.invoiceNumber ? [{ label: t.invoiceRef, value: o.invoiceNumber }] : []),
      ...(o.quotationNumber ? [{ label: t.quote, value: o.quotationNumber }] : []),
      ...(o.deliveredAt ? [{ label: t.delivered, value: d(o.deliveredAt, lang) }] : []),
    ],
    columns: columns(lang, "", false),
    items: o.items.map((i) => ({ no: i.position, description: i.description, qty: i.quantity, unit: i.unit })),
    sections: [o.notes ? { title: t.notes, body: o.notes } : null, o.receivedBy ? { title: t.receivedBy, body: [o.receivedBy, o.deliveryNotes].filter(Boolean).join("\n") } : null].filter(
      (x): x is { title: string; body: string } => Boolean(x),
    ),
    signatures: [t.deliveredBy, `${t.receivedBy} (${t.date.toLowerCase()})`],
    footer: t.footer,
    pageLabel: t.page,
  };
}

export async function renderPdf(data: PdfDocumentData): Promise<Buffer> {
  return renderToBuffer(<BusinessDocument d={data} />);
}

export function pdfFilename(kind: string, number: string) {
  return `${kind}-${number}`.replace(/[^A-Za-z0-9._-]+/g, "_") + ".pdf";
}
