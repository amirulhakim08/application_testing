import "server-only";
import type { AppContext } from "@/lib/data";
import { todayKL, type ISODate } from "@/lib/dates";
import { daysOverdue, paymentStatus, quotationDisplayStatus, sen, type PaymentStatus, type QuotationDisplayStatus } from "@/lib/documents";
import type { Cents } from "@/lib/money";

type Row = Record<string, unknown>;

// ---------------------------------------------------------------- customers & products

export interface Customer {
  id: string;
  name: string;
  companyName: string | null;
  registrationNo: string | null;
  phone: string | null;
  email: string | null;
  billingAddress: string | null;
  deliveryAddress: string | null;
  notes: string | null;
  archived: boolean;
}
const CUSTOMER_COLS = "id, name, company_name, registration_no, phone, email, billing_address, delivery_address, notes, archived_at";
function mapCustomer(r: Row): Customer {
  return {
    id: r.id as string,
    name: r.name as string,
    companyName: (r.company_name as string) ?? null,
    registrationNo: (r.registration_no as string) ?? null,
    phone: (r.phone as string) ?? null,
    email: (r.email as string) ?? null,
    billingAddress: (r.billing_address as string) ?? null,
    deliveryAddress: (r.delivery_address as string) ?? null,
    notes: (r.notes as string) ?? null,
    archived: Boolean(r.archived_at),
  };
}

/** Escape user search text for a PostgREST ilike filter. */
function searchTerm(q: string | undefined) {
  return (q ?? "").replace(/[%_\\,().*"]/g, " ").trim().slice(0, 60);
}

export async function listCustomers(ctx: AppContext, opts: { q?: string; includeArchived?: boolean; limit?: number } = {}) {
  let query = ctx.supabase.from("customers").select(CUSTOMER_COLS).eq("organization_id", ctx.company.id);
  if (!opts.includeArchived) query = query.is("archived_at", null);
  const term = searchTerm(opts.q);
  if (term) query = query.or(`name.ilike.*${term}*,company_name.ilike.*${term}*,phone.ilike.*${term}*,email.ilike.*${term}*`);
  const { data } = await query.order("name").limit(opts.limit ?? 500);
  return (data ?? []).map((r) => mapCustomer(r as Row));
}

export async function getCustomer(ctx: AppContext, id: string) {
  const { data } = await ctx.supabase.from("customers").select(CUSTOMER_COLS).eq("id", id).eq("organization_id", ctx.company.id).maybeSingle();
  return data ? mapCustomer(data as Row) : null;
}

export interface Product {
  id: string;
  kind: "product" | "service";
  name: string;
  description: string | null;
  sku: string | null;
  unit: string;
  priceCents: Cents;
  taxRate: string;
  active: boolean;
}
function mapProduct(r: Row): Product {
  return {
    id: r.id as string,
    kind: r.kind as Product["kind"],
    name: r.name as string,
    description: (r.description as string) ?? null,
    sku: (r.sku as string) ?? null,
    unit: r.unit as string,
    priceCents: sen(r.default_price),
    taxRate: String(r.tax_rate ?? "0"),
    active: Boolean(r.active),
  };
}
export async function listProducts(ctx: AppContext, opts: { q?: string; activeOnly?: boolean } = {}) {
  let query = ctx.supabase
    .from("products_services")
    .select("id, kind, name, description, sku, unit, default_price::text, tax_rate::text, active")
    .eq("organization_id", ctx.company.id);
  if (opts.activeOnly) query = query.eq("active", true);
  const term = searchTerm(opts.q);
  if (term) query = query.or(`name.ilike.*${term}*,sku.ilike.*${term}*,description.ilike.*${term}*`);
  const { data } = await query.order("name").limit(1000);
  return (data ?? []).map((r) => mapProduct(r as Row));
}

// ---------------------------------------------------------------- documents

export interface DocItem {
  position: number;
  productId: string | null;
  description: string;
  quantity: string;
  unit: string | null;
  unitPrice: string;
  discount: string;
  taxRate: string;
  lineSubtotal: Cents;
  tax: Cents;
  lineTotal: Cents;
}
export interface DocCharge {
  label: string;
  kind: "percent" | "fixed";
  value: string;
  amount: Cents;
}
export interface DocTotals {
  subtotal: Cents;
  discountTotal: Cents;
  chargesTotal: Cents;
  taxTotal: Cents;
  total: Cents;
}

const ITEM_COLS = "position, product_id, description, quantity::text, unit, unit_price::text, discount_amount::text, tax_rate::text, line_subtotal::text, tax_amount::text, line_total::text";
const TOTAL_COLS = "subtotal::text, discount_total::text, charges_total::text, tax_total::text, total::text";

function trimDecimal(s: string) {
  return s.includes(".") ? s.replace(/0+$/, "").replace(/\.$/, "") : s;
}
function mapItem(r: Row): DocItem {
  return {
    position: r.position as number,
    productId: (r.product_id as string) ?? null,
    description: r.description as string,
    quantity: trimDecimal(String(r.quantity)),
    unit: (r.unit as string) ?? null,
    unitPrice: String(r.unit_price),
    discount: String(r.discount_amount),
    taxRate: trimDecimal(String(r.tax_rate)),
    lineSubtotal: sen(r.line_subtotal),
    tax: sen(r.tax_amount),
    lineTotal: sen(r.line_total),
  };
}
function mapTotals(r: Row): DocTotals {
  return { subtotal: sen(r.subtotal), discountTotal: sen(r.discount_total), chargesTotal: sen(r.charges_total), taxTotal: sen(r.tax_total), total: sen(r.total) };
}
function mapCharges(v: unknown): DocCharge[] {
  return (Array.isArray(v) ? v : []).map((c: Row) => ({
    label: String(c.label),
    kind: c.kind === "percent" ? "percent" : "fixed",
    value: String(c.value),
    amount: sen(String(c.amount)),
  }));
}
export interface PartySnapshot {
  name?: string;
  company_name?: string | null;
  registration_no?: string | null;
  phone?: string | null;
  email?: string | null;
  billing_address?: string | null;
  delivery_address?: string | null;
}

// Quotations ---------------------------------------------------------------
export interface QuotationSummary {
  id: string;
  number: string;
  status: "draft" | "sent" | "accepted" | "rejected";
  displayStatus: QuotationDisplayStatus;
  issueDate: ISODate;
  validUntil: ISODate | null;
  customerId: string | null;
  customerName: string | null;
  total: Cents;
  convertedInvoiceId: string | null;
}
export interface Quotation extends QuotationSummary, DocTotals {
  title: string | null;
  notes: string | null;
  terms: string | null;
  items: DocItem[];
  charges: DocCharge[];
  customerSnapshot: PartySnapshot | null;
}

function mapQuotationSummary(r: Row, today: ISODate): QuotationSummary {
  const cust = r.customers as { name?: string } | null;
  const snap = r.customer_snapshot as PartySnapshot | null;
  return {
    id: r.id as string,
    number: r.number as string,
    status: r.status as QuotationSummary["status"],
    displayStatus: quotationDisplayStatus(r.status as QuotationSummary["status"], (r.valid_until as string) ?? null, today),
    issueDate: r.issue_date as string,
    validUntil: (r.valid_until as string) ?? null,
    customerId: (r.customer_id as string) ?? null,
    customerName: snap?.name ?? cust?.name ?? null,
    total: sen(r.total),
    convertedInvoiceId: (r.converted_invoice_id as string) ?? null,
  };
}

export async function listQuotations(ctx: AppContext, opts: { q?: string; status?: string; customerId?: string; limit?: number } = {}) {
  let query = ctx.supabase
    .from("quotations")
    .select("id, number, status, issue_date, valid_until, customer_id, customer_snapshot, total::text, converted_invoice_id, customers(name)")
    .eq("organization_id", ctx.company.id);
  const today = todayKL();
  if (opts.status === "expired") query = query.in("status", ["draft", "sent"]).lt("valid_until", today);
  else if (opts.status && ["draft", "sent", "accepted", "rejected"].includes(opts.status)) query = query.eq("status", opts.status);
  if (opts.customerId) query = query.eq("customer_id", opts.customerId);
  const term = searchTerm(opts.q);
  if (term) query = query.or(`number.ilike.*${term}*,title.ilike.*${term}*`);
  const { data } = await query.order("issue_date", { ascending: false }).order("number", { ascending: false }).limit(opts.limit ?? 200);
  return (data ?? []).map((r) => mapQuotationSummary(r as Row, today));
}

export async function getQuotation(ctx: AppContext, id: string): Promise<Quotation | null> {
  const { data } = await ctx.supabase
    .from("quotations")
    .select(`id, number, status, issue_date, valid_until, customer_id, customer_snapshot, converted_invoice_id, title, notes, terms, charges, ${TOTAL_COLS}, customers(name)`)
    .eq("id", id)
    .eq("organization_id", ctx.company.id)
    .maybeSingle();
  if (!data) return null;
  const { data: items } = await ctx.supabase.from("quotation_items").select(ITEM_COLS).eq("quotation_id", id).order("position");
  const r = data as Row;
  return {
    ...mapQuotationSummary(r, todayKL()),
    ...mapTotals(r),
    title: (r.title as string) ?? null,
    notes: (r.notes as string) ?? null,
    terms: (r.terms as string) ?? null,
    charges: mapCharges(r.charges),
    customerSnapshot: (r.customer_snapshot as PartySnapshot) ?? null,
    items: (items ?? []).map((i) => mapItem(i as Row)),
  };
}

// Invoices -----------------------------------------------------------------
export interface InvoiceSummary {
  id: string;
  number: string | null;
  status: "draft" | "issued" | "void";
  invoiceDate: ISODate;
  dueDate: ISODate | null;
  customerId: string | null;
  customerName: string | null;
  customerPhone: string | null;
  total: Cents;
  paid: Cents;
  outstanding: Cents;
  paymentStatus: PaymentStatus;
  daysOverdue: number;
  quotationId: string | null;
}
export interface Payment {
  id: string;
  invoiceId: string | null;
  invoiceNumber: string | null;
  customerId: string | null;
  customerName: string | null;
  amount: Cents;
  date: ISODate;
  method: string;
  reference: string | null;
  description: string | null;
  voided: boolean;
  voidReason: string | null;
  receiptId: string | null;
  receiptNumber: string | null;
  /** Set when this payment is a direct sale (receipt with items, no invoice). */
  cashSaleId: string | null;
}
export interface Invoice extends InvoiceSummary, DocTotals {
  customerPo: string | null;
  paymentTerms: string | null;
  notes: string | null;
  terms: string | null;
  voidReason: string | null;
  items: DocItem[];
  charges: DocCharge[];
  customerSnapshot: PartySnapshot | null;
  quotationNumber: string | null;
  payments: Payment[];
}

const INV_SUMMARY_COLS = "id, number, status, invoice_date, due_date, customer_id, customer_snapshot, quotation_id, total::text, customers(name, phone)";

async function balances(ctx: AppContext, ids: string[]) {
  const out = new Map<string, { paid: Cents; outstanding: Cents }>();
  for (let i = 0; i < ids.length; i += 150) {
    const { data } = await ctx.supabase.from("invoice_balances").select("invoice_id, amount_paid::text, outstanding::text").in("invoice_id", ids.slice(i, i + 150));
    for (const b of data ?? []) out.set(b.invoice_id as string, { paid: sen(b.amount_paid), outstanding: sen(b.outstanding) });
  }
  return out;
}

function mapInvoiceSummary(r: Row, bal: { paid: Cents; outstanding: Cents } | undefined, today: ISODate): InvoiceSummary {
  const cust = r.customers as { name?: string; phone?: string } | null;
  const snap = r.customer_snapshot as PartySnapshot | null;
  const total = sen(r.total);
  const status = r.status as InvoiceSummary["status"];
  const paid = bal?.paid ?? 0;
  const outstanding = status === "issued" ? (bal?.outstanding ?? total) : 0;
  return {
    id: r.id as string,
    number: (r.number as string) ?? null,
    status,
    invoiceDate: r.invoice_date as string,
    dueDate: (r.due_date as string) ?? null,
    customerId: (r.customer_id as string) ?? null,
    customerName: snap?.name ?? cust?.name ?? null,
    customerPhone: cust?.phone ?? snap?.phone ?? null,
    total,
    paid,
    outstanding,
    paymentStatus: paymentStatus(total, paid),
    daysOverdue: status === "issued" ? daysOverdue((r.due_date as string) ?? null, today, outstanding) : 0,
    quotationId: (r.quotation_id as string) ?? null,
  };
}

export async function listInvoices(
  ctx: AppContext,
  opts: { q?: string; status?: string; customerId?: string; outstandingOnly?: boolean; limit?: number } = {},
) {
  let query = ctx.supabase.from("invoices").select(INV_SUMMARY_COLS).eq("organization_id", ctx.company.id);
  if (opts.status === "draft" || opts.status === "void") query = query.eq("status", opts.status);
  else if (opts.status || opts.outstandingOnly) query = query.eq("status", "issued");
  if (opts.customerId) query = query.eq("customer_id", opts.customerId);
  const term = searchTerm(opts.q);
  if (term) query = query.or(`number.ilike.*${term}*,customer_po.ilike.*${term}*`);
  const { data } = await query.order("invoice_date", { ascending: false }).order("created_at", { ascending: false }).limit(opts.limit ?? 300);
  const rows = (data ?? []) as Row[];
  const bal = await balances(ctx, rows.filter((r) => r.status === "issued").map((r) => r.id as string));
  const today = todayKL();
  let list = rows.map((r) => mapInvoiceSummary(r, bal.get(r.id as string), today));
  if (opts.outstandingOnly) list = list.filter((i) => i.outstanding > 0);
  if (opts.status === "unpaid" || opts.status === "partial" || opts.status === "paid") list = list.filter((i) => i.paymentStatus === opts.status);
  if (opts.status === "overdue") list = list.filter((i) => i.daysOverdue > 0);
  return list;
}

const PAYMENT_COLS =
  "id, invoice_id, customer_id, amount::text, payment_date, method, reference, description, voided_at, void_reason, receipts(id, number), invoices(number), customers(name)";
/** Marks payments that are direct sales. Kept as a separate query so payment pages still work if it fails. */
async function withCashSales(ctx: AppContext, list: Payment[]): Promise<Payment[]> {
  if (list.length === 0) return list;
  const ids = new Map<string, string>();
  for (let i = 0; i < list.length; i += 150) {
    const { data, error } = await ctx.supabase.from("cash_sales").select("id, payment_id").in("payment_id", list.slice(i, i + 150).map((p) => p.id));
    if (error) return list;
    for (const r of data ?? []) ids.set(r.payment_id as string, r.id as string);
  }
  return list.map((p) => ({ ...p, cashSaleId: ids.get(p.id) ?? null }));
}

function mapPayment(r: Row): Payment {
  const rc = (Array.isArray(r.receipts) ? r.receipts[0] : r.receipts) as { id?: string; number?: string } | null;
  const inv = r.invoices as { number?: string } | null;
  const cust = r.customers as { name?: string } | null;
  return {
    id: r.id as string,
    invoiceId: (r.invoice_id as string) ?? null,
    invoiceNumber: inv?.number ?? null,
    customerId: (r.customer_id as string) ?? null,
    customerName: cust?.name ?? null,
    amount: sen(r.amount),
    date: r.payment_date as string,
    method: r.method as string,
    reference: (r.reference as string) ?? null,
    description: (r.description as string) ?? null,
    voided: Boolean(r.voided_at),
    voidReason: (r.void_reason as string) ?? null,
    receiptId: rc?.id ?? null,
    receiptNumber: rc?.number ?? null,
    cashSaleId: null,
  };
}

export async function getInvoice(ctx: AppContext, id: string): Promise<Invoice | null> {
  const { data } = await ctx.supabase
    .from("invoices")
    .select(`${INV_SUMMARY_COLS}, customer_po, payment_terms, notes, terms, void_reason, charges, ${TOTAL_COLS}, quotations!invoices_quotation_id_organization_id_fkey(number)`)
    .eq("id", id)
    .eq("organization_id", ctx.company.id)
    .maybeSingle();
  if (!data) return null;
  const r = data as Row;
  const [{ data: items }, { data: pays }, bal] = await Promise.all([
    ctx.supabase.from("invoice_items").select(ITEM_COLS).eq("invoice_id", id).order("position"),
    ctx.supabase.from("payments").select(PAYMENT_COLS).eq("invoice_id", id).order("payment_date").order("created_at"),
    balances(ctx, [id]),
  ]);
  const q = r.quotations as { number?: string } | null;
  return {
    ...mapInvoiceSummary(r, bal.get(id), todayKL()),
    ...mapTotals(r),
    customerPo: (r.customer_po as string) ?? null,
    paymentTerms: (r.payment_terms as string) ?? null,
    notes: (r.notes as string) ?? null,
    terms: (r.terms as string) ?? null,
    voidReason: (r.void_reason as string) ?? null,
    charges: mapCharges(r.charges),
    customerSnapshot: (r.customer_snapshot as PartySnapshot) ?? null,
    quotationNumber: q?.number ?? null,
    items: (items ?? []).map((i) => mapItem(i as Row)),
    payments: (pays ?? []).map((p) => mapPayment(p as Row)),
  };
}

export async function listPayments(ctx: AppContext, opts: { q?: string; customerId?: string; from?: ISODate; to?: ISODate; limit?: number } = {}) {
  let query = ctx.supabase.from("payments").select(PAYMENT_COLS).eq("organization_id", ctx.company.id);
  if (opts.from) query = query.gte("payment_date", opts.from);
  if (opts.to) query = query.lte("payment_date", opts.to);
  if (opts.customerId) query = query.eq("customer_id", opts.customerId);
  const term = searchTerm(opts.q);
  if (term) query = query.or(`reference.ilike.*${term}*,description.ilike.*${term}*`);
  const { data } = await query.order("payment_date", { ascending: false }).order("created_at", { ascending: false }).limit(opts.limit ?? 300);
  return withCashSales(ctx, (data ?? []).map((r) => mapPayment(r as Row)));
}

export async function customerSummary(ctx: AppContext, customerId: string) {
  const [invoices, quotations, payments] = await Promise.all([
    listInvoices(ctx, { customerId, limit: 500 }),
    listQuotations(ctx, { customerId, limit: 200 }),
    listPayments(ctx, { customerId, limit: 500 }),
  ]);
  const issued = invoices.filter((i) => i.status === "issued");
  return {
    invoices,
    quotations,
    payments,
    totalInvoiced: issued.reduce((a, i) => a + i.total, 0),
    totalReceived: payments.filter((p) => !p.voided).reduce((a, p) => a + p.amount, 0),
    outstanding: issued.reduce((a, i) => a + i.outstanding, 0),
  };
}

/** One payment with its receipt (for the receipt view/PDF). */
export async function getPayment(ctx: AppContext, id: string) {
  const { data } = await ctx.supabase.from("payments").select(`${PAYMENT_COLS}, notes, created_at`).eq("id", id).eq("organization_id", ctx.company.id).maybeSingle();
  if (!data) return null;
  const r = data as Row;
  const [mapped] = await withCashSales(ctx, [mapPayment(r)]);
  const payment = { ...mapped, notes: (r.notes as string) ?? null };
  return { ...payment, sale: payment.cashSaleId ? await getCashSale(ctx, payment.cashSaleId) : null };
}

export interface CashSale extends DocTotals {
  id: string;
  saleDate: ISODate;
  notes: string | null;
  items: DocItem[];
  charges: DocCharge[];
  customerSnapshot: PartySnapshot | null;
  companySnapshot: Record<string, string | null> | null;
}

async function getCashSale(ctx: AppContext, id: string): Promise<CashSale | null> {
  const { data } = await ctx.supabase
    .from("cash_sales")
    .select(`id, sale_date, notes, charges, customer_snapshot, company_snapshot, ${TOTAL_COLS}`)
    .eq("id", id)
    .eq("organization_id", ctx.company.id)
    .maybeSingle();
  if (!data) return null;
  const r = data as Row;
  const { data: items } = await ctx.supabase.from("cash_sale_items").select(ITEM_COLS).eq("cash_sale_id", id).order("position");
  return {
    id,
    saleDate: r.sale_date as string,
    notes: (r.notes as string) ?? null,
    ...mapTotals(r),
    charges: mapCharges(r.charges),
    customerSnapshot: (r.customer_snapshot as PartySnapshot) ?? null,
    companySnapshot: (r.company_snapshot as Record<string, string | null>) ?? null,
    items: (items ?? []).map((i) => mapItem(i as Row)),
  };
}
