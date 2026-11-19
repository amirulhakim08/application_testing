import Link from "next/link";
import { getContext } from "@/lib/data";
import { getI18n } from "@/lib/i18n/server";
import { listCustomers, listPayments } from "@/lib/sales";
import { formatMoney } from "@/lib/money";
import { formatDateLabel } from "@/lib/dates";
import { PageHeader } from "@/components/app/page-header";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { RecordPaymentDialog, VoidPaymentButton } from "@/components/sales/doc-actions";
import { SearchBox } from "@/components/sales/list-tools";

export const metadata = { title: "Rekod Bayaran" };

export default async function PaymentsPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const { q } = await searchParams;
  const ctx = await getContext();
  const { t, lang } = await getI18n();
  const [payments, customers] = await Promise.all([listPayments(ctx, { q }), listCustomers(ctx)]);
  const received = payments.filter((p) => !p.voided).reduce((a, p) => a + p.amount, 0);
  return (
    <div className="animate-fade-up">
      <PageHeader title={t("pay.title")} action={<RecordPaymentDialog standalone customers={customers.map((c) => ({ id: c.id, name: c.name }))} />} />
      <SearchBox />
      {payments.length > 0 && (
        <p className="mt-4 px-1 text-sm text-muted-foreground">
          {t("cus.received")}: <span className="tabular font-semibold text-foreground">{formatMoney(received)}</span>
        </p>
      )}
      <Card className="mt-3 divide-y overflow-hidden">
        {payments.length === 0 && <p className="p-10 text-center text-sm text-muted-foreground">{t("pay.empty")}</p>}
        {payments.map((p) => (
          <div key={p.id} className={`flex min-h-16 flex-wrap items-center gap-3 px-5 py-3 ${p.voided ? "opacity-60" : ""}`}>
            <span className="min-w-0 flex-1">
              <span className="flex flex-wrap items-center gap-2 font-semibold">
                {p.receiptNumber}
                {p.voided && <Badge variant="danger">{t("pay.voided")}</Badge>}
              </span>
              <span className="block truncate text-sm text-muted-foreground">
                {formatDateLabel(p.date, lang)} · {t(`pay.m.${p.method}` as "pay.m.cash")} · {p.customerName ?? "—"} ·{" "}
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
            {!p.voided && <VoidPaymentButton id={p.id} />}
          </div>
        ))}
      </Card>
    </div>
  );
}
