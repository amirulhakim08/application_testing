import Link from "next/link";
import { Plus } from "lucide-react";
import { getContext } from "@/lib/data";
import { getI18n } from "@/lib/i18n/server";
import { listDeliveryOrders } from "@/lib/delivery";
import { formatDateLabel } from "@/lib/dates";
import { PageHeader } from "@/components/app/page-header";
import { Card } from "@/components/ui/card";
import { buttonVariants } from "@/components/ui/button";
import { DeliveryBadge } from "@/components/sales/badges";
import { SearchBox, StatusChips } from "@/components/sales/list-tools";

export const metadata = { title: "Delivery Order" };

export default async function DeliveryOrdersPage({ searchParams }: { searchParams: Promise<{ q?: string; status?: string }> }) {
  const sp = await searchParams;
  const ctx = await getContext();
  const { t, lang } = await getI18n();
  const list = await listDeliveryOrders(ctx, sp);
  return (
    <div className="animate-fade-up">
      <PageHeader
        title={t("do.title")}
        action={
          <Link href="/delivery-orders/new" className={buttonVariants()}>
            <Plus /> {t("do.new")}
          </Link>
        }
      />
      <div className="grid gap-3">
        <SearchBox />
        <StatusChips
          options={[
            { value: "", label: t("c.all") },
            ...(["draft", "issued", "delivered", "cancelled"] as const).map((s) => ({ value: s, label: t(`do.status.${s}`) })),
          ]}
        />
      </div>
      <Card className="mt-3 divide-y overflow-hidden">
        {list.length === 0 && <p className="p-10 text-center text-sm text-muted-foreground">{t("do.empty")}</p>}
        {list.map((d) => (
          <Link key={d.id} href={`/delivery-orders/${d.id}`} className="flex min-h-16 items-center gap-3 px-5 py-3 hover:bg-muted/60">
            <span className="min-w-0 flex-1">
              <span className="block font-semibold">{d.number ?? t("c.draft")}</span>
              <span className="block truncate text-sm text-muted-foreground">
                {d.customerName ?? "—"} · {formatDateLabel(d.issueDate, lang)}
              </span>
            </span>
            <DeliveryBadge status={d.status} t={t} />
          </Link>
        ))}
      </Card>
    </div>
  );
}
