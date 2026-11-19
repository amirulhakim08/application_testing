"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Search } from "lucide-react";
import { cn } from "@/lib/utils";
import { useI18n } from "@/components/providers";

/** Search box bound to ?q= (debounced). */
export function SearchBox({ placeholder }: { placeholder?: string }) {
  const { t } = useI18n();
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [q, setQ] = React.useState(params.get("q") ?? "");
  React.useEffect(() => {
    const id = setTimeout(() => {
      const next = new URLSearchParams(params.toString());
      if (q.trim()) next.set("q", q.trim());
      else next.delete("q");
      if (next.toString() !== params.toString()) router.replace(`${pathname}?${next.toString()}`);
    }, 300);
    return () => clearTimeout(id);
  }, [q, params, pathname, router]);
  return (
    <label className="relative block">
      <span className="sr-only">{t("c.search")}</span>
      <Search className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
      <input
        type="search"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder={placeholder ?? t("c.search")}
        className="h-11 w-full rounded-full border border-input bg-card pl-10 pr-4 text-[15px] placeholder:text-muted-foreground/70 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
      />
    </label>
  );
}

/** Filter chips bound to ?status= */
export function StatusChips({ options }: { options: Array<{ value: string; label: string }> }) {
  const pathname = usePathname();
  const params = useSearchParams();
  const current = params.get("status") ?? "";
  return (
    <div className="-mx-1 flex gap-1.5 overflow-x-auto px-1 pb-1" role="group">
      {options.map((o) => {
        const next = new URLSearchParams(params.toString());
        if (o.value) next.set("status", o.value);
        else next.delete("status");
        const active = current === o.value;
        return (
          <Link
            key={o.value || "all"}
            href={`${pathname}?${next.toString()}`}
            aria-current={active ? "true" : undefined}
            className={cn(
              "shrink-0 rounded-full border px-3.5 py-2 text-sm font-medium transition-colors",
              active ? "border-foreground bg-foreground text-background" : "bg-card text-muted-foreground hover:bg-muted",
            )}
          >
            {o.label}
          </Link>
        );
      })}
    </div>
  );
}
