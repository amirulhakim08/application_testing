import { notFound, redirect } from "next/navigation";
import { getContext } from "@/lib/data";
import { getI18n } from "@/lib/i18n/server";
import { getDeliveryOrder } from "@/lib/delivery";
import { listCustomers, listProducts } from "@/lib/sales";
import { uuid } from "@/lib/validation";
import { PageHeader } from "@/components/app/page-header";
import { DeliveryEditor } from "@/components/sales/delivery-editor";

export default async function EditDeliveryOrderPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!uuid.safeParse(id).success) notFound();
  const ctx = await getContext();
  const { t } = await getI18n();
  const o = await getDeliveryOrder(ctx, id);
  if (!o) notFound();
  if (o.status !== "draft") redirect(`/delivery-orders/${id}`);
  const [customers, products] = await Promise.all([listCustomers(ctx), listProducts(ctx, { activeOnly: true })]);
  return (
    <div className="animate-fade-up">
      <PageHeader title={t("do.edit")} back={`/delivery-orders/${id}`} />
      <DeliveryEditor
        id={id}
        customers={customers.map((c) => ({ id: c.id, name: c.name, companyName: c.companyName, deliveryAddress: c.deliveryAddress ?? c.billingAddress }))}
        products={products.map((p) => ({ id: p.id, name: p.name, unit: p.unit }))}
        initial={{
          customerId: o.customerId,
          date: o.issueDate,
          address: o.deliveryAddress ?? "",
          notes: o.notes ?? "",
          items: o.items.map((i) => ({ description: i.description, quantity: i.quantity, unit: i.unit ?? "" })),
        }}
      />
    </div>
  );
}
