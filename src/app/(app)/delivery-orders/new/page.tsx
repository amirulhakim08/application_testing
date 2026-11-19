import { getContext } from "@/lib/data";
import { getI18n } from "@/lib/i18n/server";
import { todayKL } from "@/lib/dates";
import { listCustomers, listProducts } from "@/lib/sales";
import { PageHeader } from "@/components/app/page-header";
import { DeliveryEditor } from "@/components/sales/delivery-editor";

export const metadata = { title: "Delivery order baharu" };

export default async function NewDeliveryOrderPage() {
  const ctx = await getContext();
  const { t } = await getI18n();
  const [customers, products] = await Promise.all([listCustomers(ctx), listProducts(ctx, { activeOnly: true })]);
  return (
    <div className="animate-fade-up">
      <PageHeader title={t("do.new")} back="/delivery-orders" />
      <DeliveryEditor
        id={null}
        customers={customers.map((c) => ({ id: c.id, name: c.name, companyName: c.companyName, deliveryAddress: c.deliveryAddress ?? c.billingAddress }))}
        products={products.map((p) => ({ id: p.id, name: p.name, unit: p.unit }))}
        initial={{ customerId: null, date: todayKL(), address: "", notes: "", items: [] }}
      />
    </div>
  );
}
