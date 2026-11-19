import { getContext } from "@/lib/data";
import { getI18n } from "@/lib/i18n/server";
import { todayKL } from "@/lib/dates";
import { editorData } from "@/lib/sales-editor";
import { PageHeader } from "@/components/app/page-header";
import { DocumentEditor } from "@/components/sales/document-editor";

export const metadata = { title: "Resit jualan langsung" };

export default async function NewSaleReceiptPage() {
  const ctx = await getContext();
  const { t } = await getI18n();
  const data = await editorData(ctx);
  return (
    <div className="animate-fade-up">
      <PageHeader title={t("sale.new")} subtitle={t("sale.subtitle")} back="/receipts" />
      <DocumentEditor
        kind="sale"
        id={null}
        {...data}
        initial={{ customerId: null, date: todayKL(), secondDate: "", notes: "", terms: "", items: [], charges: [] }}
      />
    </div>
  );
}
