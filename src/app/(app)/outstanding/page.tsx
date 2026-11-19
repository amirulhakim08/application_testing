import Link from "next/link";
import { getContext } from "@/lib/data";
import { getI18n } from "@/lib/i18n/server";
import { listInvoices } from "@/lib/sales";
import { formatMoney } from "@/lib/money";
import { formatDateLabel } from "@/lib/dates";
import { PageHeader } from "@/components/app/page-header";
import { Card } from "@/components/ui/card";
import { InvoiceBadges } from "@/components/sales/badges";
import { RecordPaymentDialog, ReminderButton } from "@/components/sales/doc-actions";

export const metadata = { title: "Invois Tertunggak" };

/** Buku 555 "hutang" = balances of issued invoices. No separate debt ledger, so totals can never disagree. */
export default async function OutstandingPage() {
  const ctx = await getContext();
  const { t, lang } = await getI18n();
  const list = (await listInvoices(ctx, { outstandingOnly: true, limit: 1000 })).sort((a, b) => b.daysOverdue - a.daysOverdue || (a.dueDate ?? "").localeCompare(b.dueDate ?? ""));
  const total = list.reduce((a, i) => a + i.outstanding, 0);
  const overdue = list.filter((i) => i.daysOverdue > 0).reduce((a, i) => a + i.outstanding, 0);
  return (
    <div className="animate-fade-up">
      <PageHeader title={t("out.title")} subtitle={t("out.subtitle")} />
      <div className="grid gap-3 sm:grid-cols-2">
        <Card className="p-4">
          <div className="text-xs text-muted-foreground">{t("out.total")}</div>
          <div className="tabular mt-1 text-2xl font-semibold" data-testid="outstanding-total">
            {formatMoney(total)}
          </div>
        </Card>
        <Card className="p-4">
          <div className="text-xs text-muted-foreground">{t("out.overdueTotal")}</div>
          <div className={`tabular mt-1 text-2xl font-semibold ${overdue > 0 ? "text-destructive" : ""}`}>{formatMoney(overdue)}</div>
        </Card>
      </div>
      <div className="mt-4 grid gap-3">
        {list.length === 0 && <Card className="p-10 text-center text-sm text-muted-foreground">{t("out.empty")}</Card>}
        {list.map((i) => (
          <Card key={i.id} className="p-4">
            <div className="flex flex-wrap items-start gap-3">
              <div className="min-w-0 flex-1">
                <Link href={`/invoices/${i.id}`} className="font-semibold hover:underline">
                  {i.number}
                </Link>
                <div className="text-sm text-muted-foreground">{i.customerName ?? "—"}</div>
              </div>
              <InvoiceBadges inv={i} t={t} />
            </div>
            <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1 text-sm sm:grid-cols-5">
              <Item label={t("inv.date")} value={formatDateLabel(i.invoiceDate, lang)} />
              <Item label={t("inv.due")} value={i.dueDate ? formatDateLabel(i.dueDate, lang) : "—"} />
              <Item label={t("doc.total")} value={formatMoney(i.total)} />
              <Item label={t("inv.paid")} value={formatMoney(i.paid)} />
              <Item label={t("inv.balance")} value={formatMoney(i.outstanding)} strong />
            </dl>
            <div className="mt-3 flex flex-wrap gap-2">
              <RecordPaymentDialog invoiceId={i.id} outstandingCents={i.outstanding} />
              {i.number && <ReminderButton number={i.number} outstandingCents={i.outstanding} phone={i.customerPhone} businessName={ctx.organization.name} />}
            </div>
          </Card>
        ))}
      </div>
    </div>
  );
}

function Item({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className={`tabular ${strong ? "font-semibold text-warning" : ""}`}>{value}</dd>
    </div>
  );
}
