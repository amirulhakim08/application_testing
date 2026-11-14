import Link from "next/link";
import { Camera, Mic, PenLine } from "lucide-react";
import { formatMoney } from "@/lib/money";
import { formatDateLabel } from "@/lib/dates";
import type { TFunction, Lang } from "@/lib/i18n";
import { Badge } from "@/components/ui/badge";
import { CategoryIcon } from "./category-icon";
import { cn } from "@/lib/utils";

export interface ExpenseRowData {
  id: string;
  amountCents: number;
  merchant: string | null;
  description: string | null;
  date: string;
  workspaceKind: "personal" | "company";
  workspaceName: string;
  categoryName: string | null;
  categoryIcon: string | null;
  entryMethod: "receipt_scan" | "voice" | "manual";
  hasReceipt: boolean;
}

const METHOD_ICON = { receipt_scan: Camera, voice: Mic, manual: PenLine } as const;

export function ExpenseRow({ e, t, lang, showDate = true }: { e: ExpenseRowData; t: TFunction; lang: Lang; showDate?: boolean }) {
  const MethodIcon = METHOD_ICON[e.entryMethod];
  const title = e.merchant || e.description || e.categoryName || "—";
  const subtitle = e.merchant && e.description && e.description !== e.merchant ? e.description : e.categoryName;
  return (
    <Link href={`/expenses/${e.id}`} className="flex items-center gap-3 rounded-2xl px-2 py-2.5 transition-colors hover:bg-muted/70 sm:px-3">
      <span
        className={cn(
          "grid size-11 shrink-0 place-items-center rounded-2xl",
          e.workspaceKind === "company" ? "bg-company-soft text-company" : "bg-primary-soft text-primary",
        )}
      >
        <CategoryIcon icon={e.categoryIcon} className="size-5" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[15px] font-medium">{title}</span>
        <span className="mt-0.5 flex items-center gap-1.5 text-[12px] text-muted-foreground">
          <Badge variant={e.workspaceKind}>{e.workspaceKind === "company" ? t("ws.company") : t("ws.personal")}</Badge>
          <span className="truncate">{subtitle}</span>
        </span>
      </span>
      <span className="text-right">
        <span className="tabular block text-[15px] font-semibold">{formatMoney(e.amountCents)}</span>
        <span className="mt-0.5 flex items-center justify-end gap-1 text-[11px] text-muted-foreground">
          <MethodIcon className="size-3" aria-label={t(`method.${e.entryMethod}`)} />
          {showDate && formatDateLabel(e.date, lang, { year: undefined })}
        </span>
      </span>
    </Link>
  );
}
