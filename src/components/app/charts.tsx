"use client";

import { Bar, BarChart, CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis, Legend } from "recharts";
import { formatMoney, formatMoneyCompact } from "@/lib/money";
import type { SeriesPoint } from "@/lib/aggregate";
import { useI18n } from "@/components/providers";

type Show = "both" | "personal" | "company";

function TooltipBox({ active, payload, label, labelFormatter }: { active?: boolean; payload?: Array<{ name: string; value: number; color: string; dataKey: string }>; label?: string; labelFormatter: (l: string) => string }) {
  if (!active || !payload?.length) return null;
  const total = payload.reduce((s, p) => s + (p.value ?? 0), 0);
  return (
    <div className="rounded-xl border bg-card px-3 py-2 text-xs shadow-lg">
      <div className="mb-1 font-medium">{labelFormatter(String(label))}</div>
      {payload.map((p) => (
        <div key={p.dataKey} className="flex items-center gap-2">
          <span className="size-2 rounded-full" style={{ background: p.color }} />
          <span className="text-muted-foreground">{p.name}</span>
          <span className="tabular ml-auto pl-3 font-medium">{formatMoney(p.value)}</span>
        </div>
      ))}
      {payload.length > 1 && (
        <div className="mt-1 flex border-t pt-1">
          <span className="text-muted-foreground">Total</span>
          <span className="tabular ml-auto font-medium">{formatMoney(total)}</span>
        </div>
      )}
    </div>
  );
}

const axis = { stroke: "var(--muted-foreground)", fontSize: 11, tickLine: false, axisLine: false } as const;

export function MonthlyBars({ data, show = "both", height = 220 }: { data: SeriesPoint[]; show?: Show; height?: number }) {
  const { t, lang } = useI18n();
  const monthLabel = (k: string) =>
    new Intl.DateTimeFormat(lang === "ms" ? "ms-MY" : "en-MY", { month: "short", timeZone: "UTC" }).format(new Date(`${k}-01T00:00:00Z`));
  return (
    <div style={{ height }} role="img" aria-label={t("dash.trend")}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 8, right: 4, left: 4, bottom: 0 }} barCategoryGap="28%">
          <CartesianGrid vertical={false} stroke="var(--border)" strokeDasharray="3 3" />
          <XAxis dataKey="key" tickFormatter={monthLabel} {...axis} />
          <YAxis tickFormatter={(v: number) => formatMoneyCompact(v)} width={52} {...axis} />
          <Tooltip cursor={{ fill: "var(--muted)", opacity: 0.6 }} content={<TooltipBox labelFormatter={monthLabel} />} />
          {show === "both" && <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 12 }} formatter={(v: string) => <span style={{ color: "var(--muted-foreground)" }}>{v}</span>} />}
          {show !== "company" && (
            <Bar dataKey="personal" name={t("ws.personal")} stackId="a" fill="var(--chart-personal)" stroke="var(--card)" strokeWidth={2} radius={show === "both" ? [0, 0, 0, 0] : [4, 4, 0, 0]} maxBarSize={40} />
          )}
          {show !== "personal" && (
            <Bar dataKey="company" name={t("ws.company")} stackId="a" fill="var(--chart-company)" stroke="var(--card)" strokeWidth={2} radius={[4, 4, 0, 0]} maxBarSize={40} />
          )}
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

export function TrendLine({ data, show = "both", height = 220, weekly = false }: { data: SeriesPoint[]; show?: Show; height?: number; weekly?: boolean }) {
  const { t, lang } = useI18n();
  const dayLabel = (k: string) =>
    new Intl.DateTimeFormat(lang === "ms" ? "ms-MY" : "en-MY", { day: "numeric", month: "short", timeZone: "UTC" }).format(new Date(`${k}T00:00:00Z`));
  const label = (k: string) => (weekly ? `${t("rep.weekly")} · ${dayLabel(k)}` : dayLabel(k));
  return (
    <div style={{ height }} role="img" aria-label={t("rep.trend")}>
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 8, right: 8, left: 4, bottom: 0 }}>
          <CartesianGrid vertical={false} stroke="var(--border)" strokeDasharray="3 3" />
          <XAxis dataKey="key" tickFormatter={dayLabel} minTickGap={24} {...axis} />
          <YAxis tickFormatter={(v: number) => formatMoneyCompact(v)} width={52} {...axis} />
          <Tooltip cursor={{ stroke: "var(--muted-foreground)", strokeDasharray: "3 3" }} content={<TooltipBox labelFormatter={label} />} />
          {show === "both" && <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 12 }} formatter={(v: string) => <span style={{ color: "var(--muted-foreground)" }}>{v}</span>} />}
          {show !== "company" && (
            <Line type="monotone" dataKey="personal" name={t("ws.personal")} stroke="var(--chart-personal)" strokeWidth={2} dot={data.length <= 14 ? { r: 4, strokeWidth: 2, stroke: "var(--card)" } : false} activeDot={{ r: 5, stroke: "var(--card)", strokeWidth: 2 }} />
          )}
          {show !== "personal" && (
            <Line type="monotone" dataKey="company" name={t("ws.company")} stroke="var(--chart-company)" strokeWidth={2} dot={data.length <= 14 ? { r: 4, strokeWidth: 2, stroke: "var(--card)" } : false} activeDot={{ r: 5, stroke: "var(--card)", strokeWidth: 2 }} />
          )}
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
