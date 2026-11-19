"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getContext } from "@/lib/data";
import { uuid } from "@/lib/validation";

export type ActionResult<T = undefined> = { ok: true; data?: T } | { ok: false; error: string; fieldErrors?: Record<string, string> };

/** Our database functions raise short English messages; translate the common ones for the owner. */
function friendly(err: { message?: string; code?: string } | null, lang: "ms" | "en"): string {
  const m = (err?.message ?? "").toLowerCase();
  const pick = (ms: string, en: string) => (lang === "ms" ? ms : en);
  if (err?.code === "42501" || m.includes("not a member")) return pick("Anda tiada akses kepada rekod ini.", "You don't have access to this record.");
  if (m.includes("outstanding balance")) return pick("Jumlah melebihi baki invois.", "The amount is more than the invoice balance.");
  if (m.includes("choose a customer")) return pick("Sila pilih pelanggan dahulu.", "Please choose a customer first.");
  if (m.includes("at least one item")) return pick("Tambah sekurang-kurangnya satu item.", "Add at least one item.");
  if (m.includes("discount exceeds")) return pick("Diskaun melebihi jumlah item.", "A discount is larger than the item amount.");
  if (m.includes("void the payments")) return pick("Batalkan bayaran untuk invois ini dahulu.", "Void the payments on this invoice first.");
  if (m.includes("delivered orders cannot")) return pick("Delivery order yang sudah dihantar tidak boleh dibatalkan.", "Delivered orders cannot be cancelled.");
  if (m.includes("only draft") || m.includes("cannot be edited") || m.includes("cannot be changed"))
    return pick("Dokumen ini tidak boleh diubah lagi.", "This document can no longer be changed.");
  if (m.includes("issued invoices")) return pick("Bayaran hanya boleh direkod pada invois yang sudah dikeluarkan.", "Payments can only be recorded on issued invoices.");
  if (m.includes("total must be more")) return pick("Jumlah mesti lebih daripada sifar.", "The total must be more than zero.");
  if (m.includes("rejected quotations")) return pick("Sebut harga yang ditolak tidak boleh ditukar.", "Rejected quotations cannot be converted.");
  if (m.includes("already converted")) return pick("Sebut harga ini sudah ditukar ke invois.", "This quotation was already converted.");
  if (m.includes("reason is required")) return pick("Sila nyatakan sebab.", "Please give a reason.");
  if (m.includes("invalid")) return pick("Sila semak nilai yang dimasukkan.", "Please check the values you entered.");
  if (m.includes("not found")) return pick("Rekod tidak dijumpai.", "Record not found.");
  return pick("Tidak dapat disimpan. Sila cuba lagi.", "Could not save. Please try again.");
}

const optText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .nullable()
    .transform((s) => (s ? s : null));

const money = z.string().trim().regex(/^\d{1,9}(\.\d{1,2})?$/, "Enter an amount such as 120 or 120.50");
const rate = z
  .string()
  .trim()
  .regex(/^\d{1,3}(\.\d{1,2})?$/, "Enter a rate such as 8")
  .refine((s) => Number(s) <= 100, "Rate cannot exceed 100%");

function fieldErrors(err: z.ZodError) {
  const out: Record<string, string> = {};
  for (const i of err.issues) {
    const k = i.path.join(".") || "form";
    if (!out[k]) out[k] = i.message;
  }
  return out;
}

function refresh() {
  revalidatePath("/", "layout");
}

// ---------------------------------------------------------------- customers

const customerSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(160),
  companyName: optText(160),
  registrationNo: optText(40),
  phone: optText(40),
  email: optText(160).refine((s) => s === null || z.email().safeParse(s).success, "Invalid email"),
  billingAddress: optText(500),
  deliveryAddress: optText(500),
  notes: optText(1000),
});
export type CustomerInput = z.input<typeof customerSchema>;

export async function saveCustomer(id: string | null, input: CustomerInput): Promise<ActionResult<{ id: string }>> {
  const ctx = await getContext();
  const r = customerSchema.safeParse(input);
  if (!r.success) return { ok: false, error: friendly({ message: "invalid" }, ctx.preferences.language), fieldErrors: fieldErrors(r.error) };
  const row = {
    name: r.data.name,
    company_name: r.data.companyName,
    registration_no: r.data.registrationNo,
    phone: r.data.phone,
    email: r.data.email,
    billing_address: r.data.billingAddress,
    delivery_address: r.data.deliveryAddress,
    notes: r.data.notes,
  };
  if (id) {
    if (!uuid.safeParse(id).success) return { ok: false, error: "Invalid id" };
    const { error } = await ctx.supabase.from("customers").update(row).eq("id", id).eq("organization_id", ctx.company.id);
    if (error) return { ok: false, error: friendly(error, ctx.preferences.language) };
    refresh();
    return { ok: true, data: { id } };
  }
  const { data, error } = await ctx.supabase
    .from("customers")
    .insert({ ...row, organization_id: ctx.company.id, created_by: ctx.user.id })
    .select("id")
    .single();
  if (error || !data) return { ok: false, error: friendly(error, ctx.preferences.language) };
  refresh();
  return { ok: true, data: { id: data.id as string } };
}

export async function setCustomerArchived(id: string, archived: boolean): Promise<ActionResult> {
  const ctx = await getContext();
  if (!uuid.safeParse(id).success) return { ok: false, error: "Invalid id" };
  const { error } = await ctx.supabase
    .from("customers")
    .update({ archived_at: archived ? new Date().toISOString() : null })
    .eq("id", id)
    .eq("organization_id", ctx.company.id);
  if (error) return { ok: false, error: friendly(error, ctx.preferences.language) };
  refresh();
  return { ok: true };
}

// ---------------------------------------------------------------- products & services

const productSchema = z.object({
  kind: z.enum(["product", "service"]),
  name: z.string().trim().min(1, "Name is required").max(160),
  description: optText(2000),
  sku: optText(60),
  unit: z.string().trim().min(1).max(20).default("unit"),
  price: money,
  taxRate: rate,
  active: z.boolean().default(true),
});
export type ProductInput = z.input<typeof productSchema>;

export async function saveProduct(id: string | null, input: ProductInput): Promise<ActionResult<{ id: string }>> {
  const ctx = await getContext();
  const r = productSchema.safeParse(input);
  if (!r.success) return { ok: false, error: friendly({ message: "invalid" }, ctx.preferences.language), fieldErrors: fieldErrors(r.error) };
  const row = {
    kind: r.data.kind,
    name: r.data.name,
    description: r.data.description,
    sku: r.data.sku,
    unit: r.data.unit,
    default_price: r.data.price,
    tax_rate: r.data.taxRate,
    active: r.data.active,
  };
  if (id) {
    if (!uuid.safeParse(id).success) return { ok: false, error: "Invalid id" };
    const { error } = await ctx.supabase.from("products_services").update(row).eq("id", id).eq("organization_id", ctx.company.id);
    if (error) return { ok: false, error: friendly(error, ctx.preferences.language) };
    refresh();
    return { ok: true, data: { id } };
  }
  const { data, error } = await ctx.supabase.from("products_services").insert({ ...row, organization_id: ctx.company.id }).select("id").single();
  if (error || !data) return { ok: false, error: friendly(error, ctx.preferences.language) };
  refresh();
  return { ok: true, data: { id: data.id as string } };
}

// ---------------------------------------------------------------- documents (quotations & invoices)

const itemSchema = z.object({
  productId: uuid.nullable().optional(),
  description: z.string().trim().min(1, "Description is required").max(2000),
  quantity: z
    .string()
    .trim()
    .regex(/^\d{1,9}(\.\d{1,3})?$/, "Invalid quantity")
    .refine((s) => Number(s) > 0, "Quantity must be more than zero"),
  unit: optText(20),
  unitPrice: money,
  discount: money.or(z.literal("")).optional(),
  taxRate: rate.or(z.literal("")).optional(),
});
const chargeSchema = z.object({
  label: z.string().trim().min(1, "Label is required").max(60),
  kind: z.enum(["percent", "fixed"]),
  value: money,
});
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const docBase = {
  customerId: uuid.nullable().optional(),
  notes: optText(2000),
  terms: optText(4000),
  items: z.array(itemSchema).min(1, "Add at least one item").max(200),
  charges: z.array(chargeSchema).max(10).default([]),
};
const quotationSchema = z.object({
  ...docBase,
  issueDate: isoDate,
  validUntil: isoDate.or(z.literal("")).optional(),
  title: optText(200),
});
const invoiceSchema = z.object({
  ...docBase,
  invoiceDate: isoDate,
  dueDate: isoDate.or(z.literal("")).optional(),
  customerPo: optText(80),
  paymentTerms: optText(200),
});
export type QuotationInput = z.input<typeof quotationSchema>;
export type InvoiceInput = z.input<typeof invoiceSchema>;

function itemsPayload(items: z.output<typeof itemSchema>[]) {
  return items.map((i) => ({
    product_id: i.productId ?? null,
    description: i.description,
    quantity: i.quantity,
    unit: i.unit,
    unit_price: i.unitPrice,
    discount_amount: i.discount || "0",
    tax_rate: i.taxRate || "0",
  }));
}

export async function saveQuotation(id: string | null, input: QuotationInput): Promise<ActionResult<{ id: string }>> {
  const ctx = await getContext();
  const r = quotationSchema.safeParse(input);
  if (!r.success) return { ok: false, error: friendly({ message: "invalid" }, ctx.preferences.language), fieldErrors: fieldErrors(r.error) };
  if (id && !uuid.safeParse(id).success) return { ok: false, error: "Invalid id" };
  const d = r.data;
  const { data, error } = await ctx.supabase.rpc("save_quotation", {
    p_org: ctx.company.id,
    p_id: id,
    p_payload: {
      customer_id: d.customerId ?? null,
      issue_date: d.issueDate,
      valid_until: d.validUntil || null,
      title: d.title,
      notes: d.notes,
      terms: d.terms,
      items: itemsPayload(d.items),
      charges: d.charges,
    },
  });
  if (error || !data) return { ok: false, error: friendly(error, ctx.preferences.language) };
  refresh();
  return { ok: true, data: { id: data as string } };
}

export async function saveInvoice(id: string | null, input: InvoiceInput): Promise<ActionResult<{ id: string }>> {
  const ctx = await getContext();
  const r = invoiceSchema.safeParse(input);
  if (!r.success) return { ok: false, error: friendly({ message: "invalid" }, ctx.preferences.language), fieldErrors: fieldErrors(r.error) };
  if (id && !uuid.safeParse(id).success) return { ok: false, error: "Invalid id" };
  const d = r.data;
  const { data, error } = await ctx.supabase.rpc("save_invoice", {
    p_org: ctx.company.id,
    p_id: id,
    p_payload: {
      customer_id: d.customerId ?? null,
      invoice_date: d.invoiceDate,
      due_date: d.dueDate || null,
      customer_po: d.customerPo,
      payment_terms: d.paymentTerms,
      notes: d.notes,
      terms: d.terms,
      items: itemsPayload(d.items),
      charges: d.charges,
    },
  });
  if (error || !data) return { ok: false, error: friendly(error, ctx.preferences.language) };
  refresh();
  return { ok: true, data: { id: data as string } };
}

async function rpcSimple<T>(fn: string, args: Record<string, unknown>): Promise<ActionResult<T>> {
  const ctx = await getContext();
  for (const v of Object.values(args)) if (typeof v === "string" && v.length === 36 && !uuid.safeParse(v).success) return { ok: false, error: "Invalid id" };
  const { data, error } = await ctx.supabase.rpc(fn, args);
  if (error) return { ok: false, error: friendly(error, ctx.preferences.language) };
  refresh();
  return { ok: true, data: data as T };
}

export async function setQuotationStatus(id: string, status: "sent" | "accepted" | "rejected") {
  if (!["sent", "accepted", "rejected"].includes(status)) return { ok: false, error: "Invalid status" } as const;
  return rpcSimple<null>("set_quotation_status", { p_id: id, p_status: status });
}
export async function convertQuotation(id: string) {
  return rpcSimple<string>("convert_quotation_to_invoice", { p_id: id });
}
export async function duplicateQuotation(id: string) {
  return rpcSimple<string>("duplicate_quotation", { p_id: id });
}
export async function issueInvoice(id: string) {
  return rpcSimple<string>("issue_invoice", { p_id: id });
}
export async function voidInvoice(id: string, reason: string) {
  return rpcSimple<null>("void_invoice", { p_id: id, p_reason: reason.slice(0, 300) });
}
export async function duplicateInvoice(id: string) {
  return rpcSimple<string>("duplicate_invoice", { p_id: id });
}

// ---------------------------------------------------------------- payments

const paymentSchema = z.object({
  invoiceId: uuid.nullable(),
  customerId: uuid.nullable().optional(),
  amount: money.refine((s) => Number(s) > 0, "Amount must be more than zero"),
  date: isoDate,
  method: z.enum(["cash", "bank_transfer", "duitnow", "card", "cheque", "ewallet", "other"]),
  reference: optText(120),
  description: optText(240),
  notes: optText(1000),
  /** Generated once per payment form; makes retries and double-clicks safe. */
  requestKey: uuid,
});
export type PaymentInput = z.input<typeof paymentSchema>;

export async function recordPayment(input: PaymentInput): Promise<ActionResult<{ paymentId: string; receiptNumber: string }>> {
  const ctx = await getContext();
  const r = paymentSchema.safeParse(input);
  if (!r.success) return { ok: false, error: friendly({ message: "invalid" }, ctx.preferences.language), fieldErrors: fieldErrors(r.error) };
  const d = r.data;
  if (!d.invoiceId && !d.description) {
    return { ok: false, error: ctx.preferences.language === "ms" ? "Nyatakan bayaran untuk apa." : "Say what the payment is for.", fieldErrors: { description: "Required" } };
  }
  const { data, error } = await ctx.supabase.rpc("record_payment", {
    p_org: ctx.company.id,
    p_invoice_id: d.invoiceId,
    p_customer_id: d.customerId ?? null,
    p_amount: d.amount,
    p_date: d.date,
    p_method: d.method,
    p_reference: d.reference,
    p_description: d.description,
    p_notes: d.notes,
    p_key: d.requestKey,
  });
  const row = (Array.isArray(data) ? data[0] : data) as { payment_id?: string; receipt_number?: string } | null;
  if (error || !row?.payment_id) return { ok: false, error: friendly(error, ctx.preferences.language) };
  refresh();
  return { ok: true, data: { paymentId: row.payment_id, receiptNumber: row.receipt_number ?? "" } };
}

const cashSaleSchema = z.object({
  customerId: uuid.nullable().optional(),
  saleDate: isoDate,
  method: z.enum(["cash", "bank_transfer", "duitnow", "card", "cheque", "ewallet", "other"]),
  reference: optText(120),
  notes: optText(2000),
  items: z.array(itemSchema).min(1, "Add at least one item").max(200),
  charges: z.array(chargeSchema).max(10).default([]),
  requestKey: uuid,
});
export type CashSaleInput = z.input<typeof cashSaleSchema>;

/** Direct sale: items are priced on the server, paid in full at once and a receipt is issued. No invoice is created. */
export async function recordCashSale(input: CashSaleInput): Promise<ActionResult<{ paymentId: string; receiptNumber: string }>> {
  const ctx = await getContext();
  const r = cashSaleSchema.safeParse(input);
  if (!r.success) return { ok: false, error: friendly({ message: "invalid" }, ctx.preferences.language), fieldErrors: fieldErrors(r.error) };
  const d = r.data;
  const { data, error } = await ctx.supabase.rpc("record_cash_sale", {
    p_org: ctx.company.id,
    p_payload: {
      customer_id: d.customerId ?? null,
      sale_date: d.saleDate,
      method: d.method,
      reference: d.reference,
      notes: d.notes,
      items: itemsPayload(d.items),
      charges: d.charges,
    },
    p_key: d.requestKey,
  });
  const row = (Array.isArray(data) ? data[0] : data) as { payment_id?: string; receipt_number?: string } | null;
  if (error || !row?.payment_id) return { ok: false, error: friendly(error, ctx.preferences.language) };
  refresh();
  return { ok: true, data: { paymentId: row.payment_id, receiptNumber: row.receipt_number ?? "" } };
}

export async function voidPayment(id: string, reason: string) {
  return rpcSimple<null>("void_payment", { p_payment_id: id, p_reason: reason.slice(0, 300) });
}

// ---------------------------------------------------------------- delivery orders

const deliverySchema = z.object({
  customerId: uuid.nullable().optional(),
  issueDate: isoDate,
  deliveryAddress: optText(500),
  notes: optText(2000),
  items: z
    .array(
      z.object({
        description: z.string().trim().min(1, "Description is required").max(2000),
        quantity: z
          .string()
          .trim()
          .regex(/^\d{1,9}(\.\d{1,3})?$/, "Invalid quantity")
          .refine((s) => Number(s) > 0, "Quantity must be more than zero"),
        unit: optText(20),
      }),
    )
    .min(1, "Add at least one item")
    .max(200),
});
export type DeliveryInput = z.input<typeof deliverySchema>;

export async function saveDeliveryOrder(id: string | null, input: DeliveryInput): Promise<ActionResult<{ id: string }>> {
  const ctx = await getContext();
  const r = deliverySchema.safeParse(input);
  if (!r.success) return { ok: false, error: friendly({ message: "invalid" }, ctx.preferences.language), fieldErrors: fieldErrors(r.error) };
  if (id && !uuid.safeParse(id).success) return { ok: false, error: "Invalid id" };
  const d = r.data;
  const { data, error } = await ctx.supabase.rpc("save_delivery_order", {
    p_org: ctx.company.id,
    p_id: id,
    p_payload: { customer_id: d.customerId ?? null, issue_date: d.issueDate, delivery_address: d.deliveryAddress, notes: d.notes, items: d.items },
  });
  if (error || !data) return { ok: false, error: friendly(error, ctx.preferences.language) };
  refresh();
  return { ok: true, data: { id: data as string } };
}

export async function createDeliveryOrderFrom(source: "invoice" | "quotation", id: string) {
  if (source !== "invoice" && source !== "quotation") return { ok: false, error: "Invalid source" } as const;
  return rpcSimple<string>("create_delivery_order_from", { p_source: source, p_id: id });
}
export async function issueDeliveryOrder(id: string) {
  return rpcSimple<string>("issue_delivery_order", { p_id: id });
}
export async function markDelivered(id: string, date: string, receivedBy: string, notes: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return { ok: false, error: "Invalid date" } as const;
  return rpcSimple<null>("mark_delivery_delivered", { p_id: id, p_date: date, p_received_by: receivedBy.slice(0, 120), p_notes: notes.slice(0, 1000) });
}
export async function cancelDeliveryOrder(id: string, reason: string) {
  return rpcSimple<null>("cancel_delivery_order", { p_id: id, p_reason: reason.slice(0, 300) });
}
