import { notFound, redirect } from "next/navigation";
import { getContext } from "@/lib/data";
import { getI18n } from "@/lib/i18n/server";
import { getInvoice } from "@/lib/sales";
import { editorData, itemsToEditor } from "@/lib/sales-editor";
import { uuid } from "@/lib/validation";
import { PageHeader } from "@/components/app/page-header";
import { DocumentEditor } from "@/components/sales/document-editor";

export default async function EditInvoicePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!uuid.safeParse(id).success) notFound();
  const ctx = await getContext();
  const { t } = await getI18n();
  const inv = await getInvoice(ctx, id);
  if (!inv) notFound();
  if (inv.status !== "draft") redirect(`/invoices/${id}`); // issued invoices are immutable
  const data = await editorData(ctx);
  return (
    <div className="animate-fade-up">
      <PageHeader title={t("inv.edit")} back={`/invoices/${id}`} />
      <DocumentEditor
        kind="invoice"
        id={id}
        {...data}
        initial={{
          customerId: inv.customerId,
          date: inv.invoiceDate,
          secondDate: inv.dueDate ?? "",
          customerPo: inv.customerPo ?? "",
          paymentTerms: inv.paymentTerms ?? "",
          notes: inv.notes ?? "",
          terms: inv.terms ?? "",
          items: itemsToEditor(inv.items),
          charges: inv.charges.map((c) => ({ label: c.label, kind: c.kind, value: String(Number(c.value)) })),
        }}
      />
    </div>
  );
}
