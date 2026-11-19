import Link from "next/link";
import { getContext } from "@/lib/data";
import { getI18n } from "@/lib/i18n/server";
import { listPayments } from "@/lib/sales";
import { formatMoney } from "@/lib/money";
import { formatDateLabel } from "@/lib/dates";
import { PageHeader } from "@/components/app/page-header";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { SearchBox } from "@/components/sales/list-tools";
import { PdfButtons } from "@/components/sales/pdf-buttons";

export const metadata = { title: "Resit" };

/** Every receipt belongs to exactly one recorded payment (never to an unpaid invoice). */
export default async function ReceiptsPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const { q } = await searchParams;
  const ctx = await getContext();
  const { t, lang } = await getI18n();
  const receipts = (await listPayments(ctx, { q })).filter((p) => p.receiptNumber);
  return (
    <div className="animate-fade-up">
      <PageHeader title={t("rc.title")} subtitle={t("rc.subtitle")} />
      <SearchBox />
      <Card className="mt-4 divide-y overflow-hidden">
        {receipts.length === 0 && <p className="p-10 text-center text-sm text-muted-foreground">{t("rc.empty")}</p>}
        {receipts.map((p) => (
          <div key={p.id} className={`flex min-h-16 items-center gap-3 px-5 py-3 ${p.voided ? "opacity-60" : ""}`}>
            <span className="min-w-0 flex-1">
              <span className="flex items-center gap-2 font-semibold">
                {p.receiptNumber}
                {p.voided && <Badge variant="danger">{t("pay.voided")}</Badge>}
              </span>
              <span className="block truncate text-sm text-muted-foreground">
                {formatDateLabel(p.date, lang)} · {p.customerName ?? "—"} ·{" "}
                {p.invoiceId ? (
                  <Link href={`/invoices/${p.invoiceId}`} className="text-primary hover:underline">
                    {p.invoiceNumber}
                  </Link>
                ) : (
                  (p.description ?? t("pay.standalone"))
                )}
              </span>
            </span>
            <span className={`tabular font-semibold ${p.voided ? "line-through" : ""}`}>{formatMoney(p.amount)}</span>
            <PdfButtons compact kind="receipt" id={p.id} label={p.receiptNumber} defaultTemplate={ctx.settings.documentTemplate} />
          </div>
        ))}
      </Card>
    </div>
  );
}
