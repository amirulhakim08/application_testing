import Link from "next/link";
import { ChevronRight, Phone } from "lucide-react";
import { getContext } from "@/lib/data";
import { getI18n } from "@/lib/i18n/server";
import { listCustomers } from "@/lib/sales";
import { PageHeader } from "@/components/app/page-header";
import { Card } from "@/components/ui/card";
import { CustomerDialog } from "@/components/sales/customer-form";
import { SearchBox } from "@/components/sales/list-tools";

export const metadata = { title: "Pelanggan" };

export default async function CustomersPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const { q } = await searchParams;
  const ctx = await getContext();
  const { t } = await getI18n();
  const customers = await listCustomers(ctx, { q, includeArchived: true });
  return (
    <div className="animate-fade-up">
      <PageHeader title={t("cus.title")} action={<CustomerDialog trigger="new" />} />
      <SearchBox />
      <Card className="mt-4 divide-y overflow-hidden">
        {customers.length === 0 && <p className="p-10 text-center text-sm text-muted-foreground">{q ? t("c.none") : t("cus.empty")}</p>}
        {customers.map((c) => (
          <Link key={c.id} href={`/customers/${c.id}`} className="flex min-h-16 items-center gap-3 px-5 py-3 hover:bg-muted/60">
            <span className="grid size-10 shrink-0 place-items-center rounded-full bg-primary-soft text-sm font-semibold text-primary">
              {c.name.slice(0, 1).toUpperCase()}
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate font-medium">
                {c.name}
                {c.archived && <span className="ml-2 text-xs text-muted-foreground">({t("c.archived")})</span>}
              </span>
              <span className="block truncate text-sm text-muted-foreground">{[c.companyName, c.email].filter(Boolean).join(" · ") || "—"}</span>
            </span>
            {c.phone && (
              <span className="hidden items-center gap-1 text-sm text-muted-foreground sm:flex">
                <Phone className="size-3.5" /> {c.phone}
              </span>
            )}
            <ChevronRight className="size-4 text-muted-foreground" />
          </Link>
        ))}
      </Card>
    </div>
  );
}
