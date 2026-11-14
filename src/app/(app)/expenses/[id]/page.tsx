import { notFound } from "next/navigation";
import { getContext, getExpense } from "@/lib/data";
import { getI18n } from "@/lib/i18n/server";
import { uuid } from "@/lib/validation";
import { centsToDecimalString } from "@/lib/money";
import { PageHeader } from "@/components/app/page-header";
import { EditForm } from "@/components/app/edit-form";

export const metadata = { title: "Edit expense" };

export default async function EditExpensePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!uuid.safeParse(id).success) notFound();
  const ctx = await getContext();
  const { t } = await getI18n();
  const e = await getExpense(ctx, id);
  if (!e) notFound();
  return (
    <div className="mx-auto max-w-xl animate-fade-up">
      <PageHeader title={t("exp.edit")} back="/expenses" />
      <EditForm
        id={e.id}
        entryMethod={e.entryMethod}
        receiptFileId={e.receiptFileId}
        initial={{
          amount: centsToDecimalString(e.amountCents),
          workspaceId: e.workspaceId,
          categoryId: e.categoryId,
          merchant: e.merchant ?? "",
          description: e.description ?? "",
          date: e.date,
          time: e.time ?? "",
          notes: e.notes ?? "",
          tax: e.taxCents !== null ? centsToDecimalString(e.taxCents) : "",
          discount: e.discountCents !== null ? centsToDecimalString(e.discountCents) : "",
        }}
      />
    </div>
  );
}
