import { getContext } from "@/lib/data";
import { getI18n } from "@/lib/i18n/server";
import { todayKL } from "@/lib/dates";
import { editorData, itemsToEditor } from "@/lib/sales-editor";
import { getPayment } from "@/lib/sales";
import { uuid } from "@/lib/validation";
import { PageHeader } from "@/components/app/page-header";
import { DocumentEditor, type EditorInitial } from "@/components/sales/document-editor";

export const metadata = { title: "Resit jualan langsung" };

export default async function NewSaleReceiptPage({ searchParams }: { searchParams: Promise<{ replace?: string }> }) {
  const { replace } = await searchParams;
  const ctx = await getContext();
  const { t } = await getI18n();
  const data = await editorData(ctx);
  // "Correct receipt": start from the old direct sale receipt (still valid) so only the mistake needs fixing.
  const old = replace && uuid.safeParse(replace).success ? await getPayment(ctx, replace) : null;
  const source = old && old.sale && !old.voided && old.receiptNumber ? old : null;
  const sale = source?.sale ?? null;
  const snap = sale?.customerSnapshot ?? null;
  const initial: EditorInitial = sale
    ? {
        customerId: source!.customerId && data.customers.some((c) => c.id === source!.customerId) ? source!.customerId : null,
        customerManual: !source!.customerId && snap?.name ? { name: snap.name, phone: snap.phone ?? "", billingAddress: snap.billing_address ?? "" } : null,
        date: source!.date,
        secondDate: "",
        notes: sale.notes ?? "",
        terms: "",
        items: itemsToEditor(sale.items),
        charges: sale.charges.map((c) => ({ label: c.label, kind: c.kind, value: String(Number(c.value)) })),
      }
    : { customerId: null, date: todayKL(), secondDate: "", notes: "", terms: "", items: [], charges: [] };
  return (
    <div className="animate-fade-up">
      <PageHeader title={source ? t("rc.correct") : t("sale.new")} subtitle={source ? undefined : t("sale.subtitle")} back={source ? `/receipts/${source.id}` : "/receipts"} />
      <DocumentEditor
        kind="sale"
        id={null}
        {...data}
        initial={initial}
        replaces={source ? { paymentId: source.id, number: source.receiptNumber!, method: source.method, reference: source.reference ?? "" } : null}
      />
    </div>
  );
}
