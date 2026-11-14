"use client";

import * as React from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useI18n } from "@/components/providers";
import { Segmented } from "@/components/ui/segmented";
import type { SeriesPoint } from "@/lib/aggregate";
import { MonthlyBars, TrendLine } from "./charts";

export function ScopeSwitch({ value }: { value: "all" | "personal" | "company" }) {
  const { t } = useI18n();
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  return (
    <Segmented<"all" | "personal" | "company">
      size="sm"
      value={value}
      onChange={(v) => {
        const sp = new URLSearchParams(params.toString());
        if (v === "all") sp.delete("ws");
        else sp.set("ws", v);
        router.replace(`${pathname}?${sp}`, { scroll: false });
      }}
      options={[
        { value: "all", label: t("rep.combined") },
        { value: "personal", label: t("ws.personal"), tone: "personal" },
        { value: "company", label: t("ws.company"), tone: "company" },
      ]}
    />
  );
}

export function TrendTabs({ daily, weekly, monthly, show }: { daily: SeriesPoint[]; weekly: SeriesPoint[]; monthly: SeriesPoint[]; show: "both" | "personal" | "company" }) {
  const { t } = useI18n();
  const [tab, setTab] = React.useState<"daily" | "weekly" | "monthly">(daily.length > 62 ? "weekly" : "daily");
  return (
    <div className="grid gap-4">
      <Segmented
        size="sm"
        className="max-w-xs"
        value={tab}
        onChange={setTab}
        options={[
          { value: "daily", label: t("rep.daily") },
          { value: "weekly", label: t("rep.weekly") },
          { value: "monthly", label: t("rep.monthly") },
        ]}
      />
      {tab === "daily" && <TrendLine data={daily} show={show} height={240} />}
      {tab === "weekly" && <TrendLine data={weekly} show={show} height={240} weekly />}
      {tab === "monthly" && <MonthlyBars data={monthly} show={show} height={240} />}
    </div>
  );
}

export function MonthCompare({ data, show }: { data: SeriesPoint[]; show: "both" | "personal" | "company" }) {
  return <MonthlyBars data={data} show={show} height={240} />;
}
