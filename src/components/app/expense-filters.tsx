"use client";

import * as React from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Download, Search, SlidersHorizontal, X } from "lucide-react";
import { useI18n } from "@/components/providers";
import { Input, Label, Select } from "@/components/ui/input";
import { Segmented } from "@/components/ui/segmented";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useAppData } from "./app-data";

export function ExpenseFilterBar() {
  const { t } = useI18n();
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const { workspaces, categories } = useAppData();
  const [q, setQ] = React.useState(params.get("q") ?? "");
  const [open, setOpen] = React.useState(Boolean(params.get("category") || params.get("from") || params.get("to") || params.get("min") || params.get("max")));
  const [, startTransition] = React.useTransition();

  const set = React.useCallback(
    (patch: Record<string, string | null>) => {
      const sp = new URLSearchParams(params.toString());
      for (const [k, v] of Object.entries(patch)) (v ? sp.set(k, v) : sp.delete(k));
      startTransition(() => router.replace(`${pathname}${sp.size ? `?${sp}` : ""}`, { scroll: false }));
    },
    [params, pathname, router],
  );

  React.useEffect(() => {
    const id = setTimeout(() => {
      if ((params.get("q") ?? "") !== q) set({ q: q.trim() || null });
    }, 300);
    return () => clearTimeout(id);
  }, [q, params, set]);

  const ws = (params.get("ws") as "personal" | "company" | null) ?? "all";
  const wsId = ws === "all" ? null : workspaces.find((w) => w.kind === ws)?.id;
  const cats = categories.filter((c) => !wsId || c.workspaceId === wsId);
  const exportHref = `/api/expenses/export${params.size ? `?${params}` : ""}`;
  const active = ["category", "from", "to", "min", "max"].filter((k) => params.get(k)).length;

  return (
    <div className="grid gap-3">
      <div className="flex gap-2">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder={t("exp.search")} className="pl-10" aria-label={t("exp.search")} />
        </div>
        <Button variant="outline" size="icon" onClick={() => setOpen((o) => !o)} aria-expanded={open} aria-label={t("exp.filters")} className={cn("relative rounded-xl", active && "border-primary text-primary")}>
          <SlidersHorizontal />
          {active > 0 && <span className="absolute -right-1 -top-1 grid size-5 place-items-center rounded-full bg-primary text-[10px] text-primary-foreground">{active}</span>}
        </Button>
        <Button variant="outline" size="icon" asChild className="rounded-xl" aria-label={t("exp.export")}>
          <a href={exportHref} download>
            <Download />
          </a>
        </Button>
      </div>
      <Segmented<"all" | "personal" | "company">
        size="sm"
        value={ws}
        onChange={(v) => set({ ws: v === "all" ? null : v, category: null })}
        options={[
          { value: "all", label: t("ws.both") },
          { value: "personal", label: t("ws.personal"), tone: "personal" },
          { value: "company", label: t("ws.company"), tone: "company" },
        ]}
      />
      {open && (
        <div className="grid animate-fade-up gap-3 rounded-2xl border bg-card p-4 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <Label htmlFor="flt-cat">{t("form.category")}</Label>
            <Select id="flt-cat" value={params.get("category") ?? ""} onChange={(e) => set({ category: e.target.value || null })}>
              <option value="">{t("exp.allCategories")}</option>
              {cats.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.label}
                  {!wsId ? ` · ${workspaces.find((w) => w.id === c.workspaceId)?.kind === "company" ? t("ws.company") : t("ws.personal")}` : ""}
                  {c.archived ? ` (${t("cat.archived")})` : ""}
                </option>
              ))}
            </Select>
          </div>
          <div>
            <Label htmlFor="flt-from">{t("period.from")}</Label>
            <Input id="flt-from" type="date" value={params.get("from") ?? ""} onChange={(e) => set({ from: e.target.value || null })} />
          </div>
          <div>
            <Label htmlFor="flt-to">{t("period.to")}</Label>
            <Input id="flt-to" type="date" value={params.get("to") ?? ""} onChange={(e) => set({ to: e.target.value || null })} />
          </div>
          <div>
            <Label htmlFor="flt-min">{t("exp.minAmount")}</Label>
            <Input id="flt-min" inputMode="decimal" defaultValue={params.get("min") ?? ""} onBlur={(e) => set({ min: e.target.value.trim() || null })} />
          </div>
          <div>
            <Label htmlFor="flt-max">{t("exp.maxAmount")}</Label>
            <Input id="flt-max" inputMode="decimal" defaultValue={params.get("max") ?? ""} onBlur={(e) => set({ max: e.target.value.trim() || null })} />
          </div>
          {active > 0 && (
            <Button variant="ghost" size="sm" className="justify-self-start" onClick={() => set({ category: null, from: null, to: null, min: null, max: null })}>
              <X /> {t("exp.clear")}
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
