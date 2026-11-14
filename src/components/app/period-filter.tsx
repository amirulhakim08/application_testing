"use client";

import * as React from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { CalendarRange } from "lucide-react";
import { cn } from "@/lib/utils";
import { useI18n } from "@/components/providers";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/input";
import type { PeriodKey } from "@/lib/periods";

const KEYS: Array<Exclude<PeriodKey, "custom">> = ["today", "week", "month", "last_month"];

export function PeriodFilter({ value, from, to }: { value: PeriodKey; from: string; to: string }) {
  const { t } = useI18n();
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [open, setOpen] = React.useState(false);
  const [range, setRange] = React.useState({ from, to });
  const [pending, startTransition] = React.useTransition();

  const go = (next: Record<string, string | null>) => {
    const sp = new URLSearchParams(params.toString());
    for (const [k, v] of Object.entries(next)) (v === null ? sp.delete(k) : sp.set(k, v));
    startTransition(() => router.replace(`${pathname}?${sp.toString()}`, { scroll: false }));
  };

  return (
    <div className={cn("-mx-4 overflow-x-auto px-4 [scrollbar-width:none] sm:mx-0 sm:px-0", pending && "opacity-70")}>
      <div className="flex w-max gap-2">
        {KEYS.map((k) => (
          <button
            key={k}
            type="button"
            onClick={() => go({ period: k === "month" ? null : k, from: null, to: null })}
            className={cn(
              "h-9 rounded-full border px-4 text-sm font-medium transition-colors",
              value === k ? "border-foreground bg-foreground text-background" : "bg-card text-muted-foreground hover:text-foreground",
            )}
          >
            {t(`period.${k}`)}
          </button>
        ))}
        <button
          type="button"
          onClick={() => setOpen(true)}
          className={cn(
            "flex h-9 items-center gap-1.5 rounded-full border px-4 text-sm font-medium transition-colors",
            value === "custom" ? "border-foreground bg-foreground text-background" : "bg-card text-muted-foreground hover:text-foreground",
          )}
        >
          <CalendarRange className="size-4" />
          {value === "custom" ? `${from} → ${to}` : t("period.custom")}
        </button>
      </div>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent title={t("period.custom")}>
          <form
            className="grid gap-4"
            onSubmit={(e) => {
              e.preventDefault();
              setOpen(false);
              go({ period: "custom", from: range.from, to: range.to });
            }}
          >
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label htmlFor="pf-from">{t("period.from")}</Label>
                <Input id="pf-from" type="date" required value={range.from} onChange={(e) => setRange((r) => ({ ...r, from: e.target.value }))} />
              </div>
              <div>
                <Label htmlFor="pf-to">{t("period.to")}</Label>
                <Input id="pf-to" type="date" required value={range.to} onChange={(e) => setRange((r) => ({ ...r, to: e.target.value }))} />
              </div>
            </div>
            <Button type="submit" size="lg">{t("period.apply")}</Button>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
