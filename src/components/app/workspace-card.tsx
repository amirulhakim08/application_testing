import { ArrowDownRight, ArrowUpRight, Briefcase, User } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatMoney } from "@/lib/money";
import type { WorkspaceSummary } from "@/lib/aggregate";
import type { TFunction } from "@/lib/i18n";

export function WorkspaceCard({ kind, name, summary, t }: { kind: "personal" | "company"; name: string; summary: WorkspaceSummary; t: TFunction }) {
  const personal = kind === "personal";
  const change = summary.changePct;
  const up = change !== null && change > 0;
  return (
    <section
      aria-label={name}
      className={cn(
        "relative isolate flex min-h-44 flex-col overflow-hidden rounded-3xl p-4 text-white shadow-lg sm:min-h-52 sm:p-6",
        personal
          ? "bg-[linear-gradient(145deg,#1b5a40_0%,#123f2d_60%,#0d3123_100%)] shadow-[#1b5a40]/20"
          : "bg-[linear-gradient(145deg,#2f4a8a_0%,#21376b_60%,#192a54_100%)] shadow-[#2f4a8a]/20",
      )}
    >
      <div aria-hidden className="pointer-events-none absolute -right-10 -top-12 -z-10 size-40 rounded-full bg-white/10 blur-2xl" />
      <div aria-hidden className="pointer-events-none absolute -bottom-16 -left-10 -z-10 size-44 rounded-full bg-white/5" />
      <div className="flex items-center justify-between gap-2">
        <span className="flex min-w-0 items-center gap-1.5 text-[13px] font-medium text-white/80 sm:text-sm">
          {personal ? <User className="size-4 shrink-0" /> : <Briefcase className="size-4 shrink-0" />}
          <span className="truncate">{name}</span>
        </span>
      </div>
      <div className="mt-auto pt-6">
        <div className="text-[11px] font-medium uppercase tracking-wider text-white/60">{t("dash.totalSpent")}</div>
        <div className="tabular mt-0.5 break-all text-[22px] font-semibold leading-tight tracking-tight sm:text-4xl">{formatMoney(summary.total)}</div>
        <div className="mt-3 grid gap-1 text-[12px] text-white/75 sm:flex sm:flex-wrap sm:gap-x-4 sm:text-[13px]">
          <span>
            {t("dash.today")}: <span className="tabular font-medium text-white">{formatMoney(summary.today)}</span>
          </span>
          <span>{summary.count === 1 ? t("dash.transaction") : t("dash.transactions", { n: summary.count })}</span>
        </div>
        <div className="mt-2 flex items-center gap-1 text-[12px] text-white/75 sm:text-[13px]">
          {change === null ? (
            <span>{t("dash.noPrev")}</span>
          ) : (
            <>
              <span className={cn("inline-flex items-center rounded-full px-1.5 py-0.5 font-medium", up ? "bg-white/15 text-white" : "bg-white/15 text-white")}>
                {up ? <ArrowUpRight className="size-3.5" /> : <ArrowDownRight className="size-3.5" />}
                <span className="tabular">{Math.abs(change)}%</span>
              </span>
              <span className="truncate">{t("dash.vsPrev")}</span>
            </>
          )}
        </div>
      </div>
    </section>
  );
}
