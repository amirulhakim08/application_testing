import Link from "next/link";
import { Plus } from "lucide-react";
import { getContext } from "@/lib/data";
import { getI18n } from "@/lib/i18n/server";
import { listInvoices } from "@/lib/sales";
import { formatMoney } from "@/lib/money";
import { formatDateLabel } from "@/lib/dates";
import { PageHeader } from "@/components/app/page-header";
import { Card } from "@/components/ui/card";
import { buttonVariants } from "@/components/ui/button";
import { InvoiceBadges } from "@/components/sales/badges";
import { SearchBox, StatusChips } from "@/components/sales/list-tools";

export const metadata = { title: "Invois" };

export default async function InvoicesPage({ searchParams }: { searchParams: Promise<{ q?: string; status?: string }> }) {
  const sp = await searchParams;
  const ctx = await getContext();
  const { t, lang } = await getI18n();
  const list = await listInvoices(ctx, sp);
  return (
    <div className="animate-fade-up">
      <PageHeader
        title={t("inv.title")}
        action={
          <Link href="/invoices/new" className={buttonVariants()}>
            <Plus /> {t("inv.new")}
          </Link>
        }
      />
      <div className="grid gap-3">
        <SearchBox />
        <StatusChips
          options={[
            { value: "", label: t("c.all") },
            { value: "draft", label: t("inv.lifecycle.draft") },
            { value: "unpaid", label: t("inv.pay.unpaid") },
            { value: "partial", label: t("inv.pay.partial") },
            { value: "paid", label: t("inv.pay.paid") },
            { value: "overdue", label: t("out.overdueTotal") },
            { value: "void", label: t("inv.lifecycle.void") },
          ]}
        />
      </div>
      <Card className="mt-3 divide-y overflow-hidden">
        {list.length === 0 && <p className="p-10 text-center text-sm text-muted-foreground">{t("inv.empty")}</p>}
        {list.map((i) => (
          <Link key={i.id} href={`/invoices/${i.id}`} className="flex min-h-16 flex-wrap items-center gap-x-3 gap-y-1 px-5 py-3 hover:bg-muted/60">
            <span className="min-w-0 flex-1">
              <span className="block font-semibold">{i.number ?? t("c.draft")}</span>
              <span className="block truncate text-sm text-muted-foreground">
                {i.customerName ?? "—"} · {formatDateLabel(i.invoiceDate, lang)}
              </span>
            </span>
            <InvoiceBadges inv={i} t={t} />
            <span className="w-32 text-right">
              <span className="tabular block font-semibold">{formatMoney(i.total)}</span>
              {i.status === "issued" && i.outstanding > 0 && i.outstanding < i.total && (
                <span className="tabular block text-xs text-muted-foreground">
                  {t("inv.balance")} {formatMoney(i.outstanding)}
                </span>
              )}
            </span>
          </Link>
        ))}
      </Card>
    </div>
  );
}
