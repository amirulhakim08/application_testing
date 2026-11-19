import "server-only";
import type { AppContext } from "@/lib/data";
import { listCustomers, listProducts, type DocItem } from "@/lib/sales";
import type { EditorProduct, EditorCustomer, EditorInitial } from "@/components/sales/document-editor";

export async function editorData(ctx: AppContext) {
  const [customers, products] = await Promise.all([listCustomers(ctx), listProducts(ctx, { activeOnly: true })]);
  return {
    customers: customers.map<EditorCustomer>((c) => ({ id: c.id, name: c.name, companyName: c.companyName })),
    products: products.map<EditorProduct>((p) => ({ id: p.id, name: p.name, description: p.description, unit: p.unit, priceCents: p.priceCents, taxRate: p.taxRate })),
    defaultTaxRate: String(Number(ctx.settings.defaultTaxRate)),
    taxLabel: ctx.settings.taxLabel,
  };
}

export function itemsToEditor(items: DocItem[]): EditorInitial["items"] {
  return items.map((i) => ({
    productId: i.productId,
    description: i.description,
    quantity: i.quantity,
    unit: i.unit ?? "",
    unitPrice: i.unitPrice,
    discount: Number(i.discount) > 0 ? i.discount : "",
    taxRate: i.taxRate,
  }));
}
