import { getContext } from "@/lib/data";
import { getI18n } from "@/lib/i18n/server";
import { addDays, todayKL } from "@/lib/dates";
import { editorData } from "@/lib/sales-editor";
import { uuid } from "@/lib/validation";
import { PageHeader } from "@/components/app/page-header";
import { DocumentEditor } from "@/components/sales/document-editor";

export const metadata = { title: "Sebut harga baharu" };

export default async function NewQuotationPage({ searchParams }: { searchParams: Promise<{ customer?: string }> }) {
  const { customer } = await searchParams;
  const ctx = await getContext();
  const { t } = await getI18n();
  const data = await editorData(ctx);
  const today = todayKL();
  const customerId = customer && uuid.safeParse(customer).success && data.customers.some((c) => c.id === customer) ? customer : null;
  return (
    <div className="animate-fade-up">
      <PageHeader title={t("qt.new")} back="/quotations" />
      <DocumentEditor
        kind="quotation"
        id={null}
        {...data}
        initial={{
          customerId,
          date: today,
          secondDate: addDays(today, ctx.settings.quotationValidityDays),
          notes: ctx.settings.defaultNotes ?? "",
          terms: ctx.settings.defaultTerms ?? "",
          items: [],
          charges: [],
        }}
      />
    </div>
  );
}
