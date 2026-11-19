import Link from "next/link";
import { Plus } from "lucide-react";
import { getContext } from "@/lib/data";
import { getI18n } from "@/lib/i18n/server";
import { listQuotations } from "@/lib/sales";
import { formatMoney } from "@/lib/money";
import { formatDateLabel } from "@/lib/dates";
import { PageHeader } from "@/components/app/page-header";
import { Card } from "@/components/ui/card";
import { buttonVariants } from "@/components/ui/button";
import { QuotationBadge } from "@/components/sales/badges";
import { SearchBox, StatusChips } from "@/components/sales/list-tools";

export const metadata = { title: "Sebut Harga" };

export default async function QuotationsPage({ searchParams }: { searchParams: Promise<{ q?: string; status?: string }> }) {
  const sp = await searchParams;
  const ctx = await getContext();
  const { t, lang } = await getI18n();
  const list = await listQuotations(ctx, sp);
  return (
    <div className="animate-fade-up">
      <PageHeader
        title={t("qt.title")}
        action={
          <Link href="/quotations/new" className={buttonVariants()}>
            <Plus /> {t("qt.new")}
          </Link>
        }
      />
      <div className="grid gap-3">
        <SearchBox />
        <StatusChips
          options={[
            { value: "", label: t("c.all") },
            ...(["draft", "sent", "accepted", "rejected", "expired"] as const).map((s) => ({ value: s, label: t(`qt.status.${s}`) })),
          ]}
        />
      </div>
      <Card className="mt-3 divide-y overflow-hidden">
        {list.length === 0 && <p className="p-10 text-center text-sm text-muted-foreground">{t("qt.empty")}</p>}
        {list.map((q) => (
          <Link key={q.id} href={`/quotations/${q.id}`} className="flex min-h-16 items-center gap-3 px-5 py-3 hover:bg-muted/60">
            <span className="min-w-0 flex-1">
              <span className="block font-semibold">{q.number}</span>
              <span className="block truncate text-sm text-muted-foreground">
                {q.customerName ?? "—"} · {formatDateLabel(q.issueDate, lang)}
              </span>
            </span>
            <QuotationBadge status={q.displayStatus} t={t} />
            <span className="tabular w-28 text-right font-semibold">{formatMoney(q.total)}</span>
          </Link>
        ))}
      </Card>
    </div>
  );
}
