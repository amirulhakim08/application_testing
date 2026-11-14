import { formatMoney } from "@/lib/money";
import type { CategorySlice } from "@/lib/aggregate";
import { CategoryIcon } from "./category-icon";

/** Horizontal magnitude bars — one series, sorted, values in text ink. */
export function CategoryBars({
  slices,
  categories,
  tone,
  limit = 6,
  empty,
}: {
  slices: CategorySlice[];
  categories: Map<string, { name: string; icon: string | null }>;
  tone: "personal" | "company";
  limit?: number;
  empty: string;
}) {
  if (!slices.length) return <p className="py-6 text-center text-sm text-muted-foreground">{empty}</p>;
  const max = slices[0].total;
  return (
    <ul className="grid gap-3.5">
      {slices.slice(0, limit).map((s) => {
        const c = s.categoryId ? categories.get(s.categoryId) : null;
        return (
          <li key={s.categoryId ?? "none"}>
            <div className="mb-1.5 flex items-center gap-2 text-sm">
              <CategoryIcon icon={c?.icon} className="size-4 text-muted-foreground" />
              <span className="flex-1 truncate">{c?.name ?? "Uncategorised"}</span>
              <span className="tabular text-muted-foreground">{Math.round(s.share * 100)}%</span>
              <span className="tabular w-24 text-right font-medium">{formatMoney(s.total)}</span>
            </div>
            <div className="h-2 overflow-hidden rounded-full bg-muted">
              <div
                className="h-full rounded-full"
                style={{ width: `${Math.max(2, (s.total / max) * 100)}%`, background: tone === "company" ? "var(--chart-company)" : "var(--chart-personal)" }}
              />
            </div>
          </li>
        );
      })}
    </ul>
  );
}
