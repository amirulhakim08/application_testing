import { getContext } from "@/lib/data";
import { getI18n } from "@/lib/i18n/server";
import { listProducts } from "@/lib/sales";
import { formatMoney } from "@/lib/money";
import { rm } from "@/lib/documents";
import { PageHeader } from "@/components/app/page-header";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ProductDialog } from "@/components/sales/product-form";
import { SearchBox } from "@/components/sales/list-tools";

export const metadata = { title: "Produk & Servis" };

export default async function ProductsPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const { q } = await searchParams;
  const ctx = await getContext();
  const { t } = await getI18n();
  const items = await listProducts(ctx, { q });
  const defaultTax = String(Number(ctx.settings.defaultTaxRate));
  return (
    <div className="animate-fade-up">
      <PageHeader title={t("prd.title")} action={<ProductDialog defaultTaxRate={defaultTax} />} />
      <SearchBox />
      <Card className="mt-4 divide-y overflow-hidden">
        {items.length === 0 && <p className="p-10 text-center text-sm text-muted-foreground">{q ? t("c.none") : t("prd.empty")}</p>}
        {items.map((p) => (
          <div key={p.id} className={`flex min-h-16 items-center gap-3 px-5 py-3 ${p.active ? "" : "opacity-60"}`}>
            <span className="min-w-0 flex-1">
              <span className="flex items-center gap-2 font-medium">
                <span className="truncate">{p.name}</span>
                <Badge variant={p.kind === "product" ? "accent" : "info"}>{p.kind === "product" ? t("prd.product") : t("prd.service")}</Badge>
                {!p.active && <Badge>{t("prd.inactive")}</Badge>}
              </span>
              <span className="block truncate text-sm text-muted-foreground">
                {[p.sku, p.description].filter(Boolean).join(" · ") || "—"}
              </span>
            </span>
            <span className="text-right">
              <span className="tabular block font-semibold">{formatMoney(p.priceCents)}</span>
              <span className="block text-xs text-muted-foreground">
                / {p.unit}
                {Number(p.taxRate) > 0 ? ` · ${ctx.settings.taxLabel} ${Number(p.taxRate)}%` : ""}
              </span>
            </span>
            <ProductDialog
              id={p.id}
              defaultTaxRate={defaultTax}
              initial={{ kind: p.kind, name: p.name, description: p.description, sku: p.sku, unit: p.unit, price: rm(p.priceCents), taxRate: String(Number(p.taxRate)), active: p.active }}
            />
          </div>
        ))}
      </Card>
    </div>
  );
}
