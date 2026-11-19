import { getContext } from "@/lib/data";
import { getI18n } from "@/lib/i18n/server";
import { addDays, todayKL } from "@/lib/dates";
import { editorData } from "@/lib/sales-editor";
import { uuid } from "@/lib/validation";
import { PageHeader } from "@/components/app/page-header";
import { DocumentEditor } from "@/components/sales/document-editor";

export const metadata = { title: "Invois baharu" };

export default async function NewInvoicePage({ searchParams }: { searchParams: Promise<{ customer?: string }> }) {
  const { customer } = await searchParams;
  const ctx = await getContext();
  const { t } = await getI18n();
  const data = await editorData(ctx);
  const today = todayKL();
  const days = ctx.settings.paymentTermsDays;
  const customerId = customer && uuid.safeParse(customer).success && data.customers.some((c) => c.id === customer) ? customer : null;
  return (
    <div className="animate-fade-up">
      <PageHeader title={t("inv.new")} back="/invoices" />
      <DocumentEditor
        kind="invoice"
        id={null}
        {...data}
        initial={{
          customerId,
          date: today,
          secondDate: addDays(today, days),
          paymentTerms: days > 0 ? `${days} hari` : "",
          notes: ctx.settings.defaultNotes ?? "",
          terms: ctx.settings.defaultTerms ?? "",
          items: [],
          charges: [],
        }}
      />
    </div>
  );
}
