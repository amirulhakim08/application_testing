import "server-only";
import type { AppContext } from "@/lib/data";
import type { ISODate } from "@/lib/dates";
import type { PartySnapshot } from "@/lib/sales";

type Row = Record<string, unknown>;

export type DeliveryStatus = "draft" | "issued" | "delivered" | "cancelled";
export interface DeliveryItem {
  position: number;
  description: string;
  quantity: string;
  unit: string | null;
}
export interface DeliveryOrderSummary {
  id: string;
  number: string | null;
  status: DeliveryStatus;
  issueDate: ISODate;
  customerId: string | null;
  customerName: string | null;
  invoiceId: string | null;
  quotationId: string | null;
  deliveredAt: ISODate | null;
}
export interface DeliveryOrder extends DeliveryOrderSummary {
  deliveryAddress: string | null;
  notes: string | null;
  receivedBy: string | null;
  deliveryNotes: string | null;
  cancelReason: string | null;
  customerSnapshot: PartySnapshot | null;
  invoiceNumber: string | null;
  quotationNumber: string | null;
  items: DeliveryItem[];
}

const COLS = "id, number, status, issue_date, customer_id, customer_snapshot, invoice_id, quotation_id, delivered_at, customers(name)";

function trimDecimal(s: string) {
  return s.includes(".") ? s.replace(/0+$/, "").replace(/\.$/, "") : s;
}
function mapSummary(r: Row): DeliveryOrderSummary {
  const snap = r.customer_snapshot as PartySnapshot | null;
  const cust = r.customers as { name?: string } | null;
  return {
    id: r.id as string,
    number: (r.number as string) ?? null,
    status: r.status as DeliveryStatus,
    issueDate: r.issue_date as string,
    customerId: (r.customer_id as string) ?? null,
    customerName: snap?.name ?? cust?.name ?? null,
    invoiceId: (r.invoice_id as string) ?? null,
    quotationId: (r.quotation_id as string) ?? null,
    deliveredAt: (r.delivered_at as string) ?? null,
  };
}

export async function listDeliveryOrders(ctx: AppContext, opts: { status?: string; q?: string; invoiceId?: string; limit?: number } = {}) {
  let query = ctx.supabase.from("delivery_orders").select(COLS).eq("organization_id", ctx.company.id);
  if (opts.status && ["draft", "issued", "delivered", "cancelled"].includes(opts.status)) query = query.eq("status", opts.status);
  if (opts.invoiceId) query = query.eq("invoice_id", opts.invoiceId);
  const term = (opts.q ?? "").replace(/[%_\\,().*"]/g, " ").trim().slice(0, 60);
  if (term) query = query.or(`number.ilike.*${term}*,delivery_address.ilike.*${term}*`);
  const { data } = await query.order("issue_date", { ascending: false }).order("created_at", { ascending: false }).limit(opts.limit ?? 300);
  return (data ?? []).map((r) => mapSummary(r as Row));
}

export async function getDeliveryOrder(ctx: AppContext, id: string): Promise<DeliveryOrder | null> {
  const { data } = await ctx.supabase
    .from("delivery_orders")
    .select(`${COLS}, delivery_address, notes, received_by, delivery_notes, cancel_reason, invoices!delivery_orders_invoice_id_organization_id_fkey(number), quotations!delivery_orders_quotation_id_organization_id_fkey(number)`)
    .eq("id", id)
    .eq("organization_id", ctx.company.id)
    .maybeSingle();
  if (!data) return null;
  const r = data as Row;
  const { data: items } = await ctx.supabase.from("delivery_order_items").select("position, description, quantity::text, unit").eq("delivery_order_id", id).order("position");
  return {
    ...mapSummary(r),
    deliveryAddress: (r.delivery_address as string) ?? null,
    notes: (r.notes as string) ?? null,
    receivedBy: (r.received_by as string) ?? null,
    deliveryNotes: (r.delivery_notes as string) ?? null,
    cancelReason: (r.cancel_reason as string) ?? null,
    customerSnapshot: (r.customer_snapshot as PartySnapshot) ?? null,
    invoiceNumber: (r.invoices as { number?: string } | null)?.number ?? null,
    quotationNumber: (r.quotations as { number?: string } | null)?.number ?? null,
    items: (items ?? []).map((i) => ({
      position: i.position as number,
      description: i.description as string,
      quantity: trimDecimal(String(i.quantity)),
      unit: (i.unit as string) ?? null,
    })),
  };
}
