import { notFound, redirect } from "next/navigation";
import { getContext } from "@/lib/data";
import { getI18n } from "@/lib/i18n/server";
import { getQuotation } from "@/lib/sales";
import { editorData, itemsToEditor } from "@/lib/sales-editor";
import { uuid } from "@/lib/validation";
import { PageHeader } from "@/components/app/page-header";
import { DocumentEditor } from "@/components/sales/document-editor";

export default async function EditQuotationPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!uuid.safeParse(id).success) notFound();
  const ctx = await getContext();
  const { t } = await getI18n();
  const q = await getQuotation(ctx, id);
  if (!q) notFound();
  if (q.status !== "draft") redirect(`/quotations/${id}`);
  const data = await editorData(ctx);
  return (
    <div className="animate-fade-up">
      <PageHeader title={`${t("qt.edit")} ${q.number}`} back={`/quotations/${id}`} />
      <DocumentEditor
        kind="quotation"
        id={id}
        {...data}
        initial={{
          customerId: q.customerId,
          customerManual:
            !q.customerId && q.customerSnapshot?.name
              ? {
                  name: q.customerSnapshot.name,
                  companyName: q.customerSnapshot.company_name ?? "",
                  phone: q.customerSnapshot.phone ?? "",
                  email: q.customerSnapshot.email ?? "",
                  billingAddress: q.customerSnapshot.billing_address ?? "",
                }
              : null,
          date: q.issueDate,
          secondDate: q.validUntil ?? "",
          title: q.title ?? "",
          notes: q.notes ?? "",
          terms: q.terms ?? "",
          items: itemsToEditor(q.items),
          charges: q.charges.map((c) => ({ label: c.label, kind: c.kind, value: String(Number(c.value)) })),
        }}
      />
    </div>
  );
}
