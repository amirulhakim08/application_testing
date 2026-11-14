"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { AlertTriangle } from "lucide-react";
import { saveExpenses, type DuplicateInfo } from "@/app/actions/expenses";
import type { ExpenseInput } from "@/lib/validation";
import { useI18n } from "@/components/providers";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { formatMoney } from "@/lib/money";
import { formatDateLabel } from "@/lib/dates";

/**
 * Save confirmed expenses; on a likely duplicate, show a warning and let the
 * user explicitly choose to save anyway.
 */
export function useSaveExpenses({ redirectTo = "/" }: { redirectTo?: string } = {}) {
  const { t, lang } = useI18n();
  const router = useRouter();
  const [pending, setPending] = React.useState(false);
  const [dups, setDups] = React.useState<{ list: DuplicateInfo[]; inputs: ExpenseInput[] } | null>(null);
  const [fieldErrors, setFieldErrors] = React.useState<{ index: number; errors: Record<string, string> } | null>(null);

  const save = React.useCallback(
    async (inputs: ExpenseInput[]) => {
      setPending(true);
      setFieldErrors(null);
      try {
        const res = await saveExpenses(inputs);
        if (res.ok) {
          toast.success(res.ids.length > 1 ? t("toast.savedMany", { n: res.ids.length }) : t("toast.saved"));
          router.push(redirectTo);
          router.refresh();
          return true;
        }
        if ("duplicates" in res) {
          setDups({ list: res.duplicates, inputs });
          return false;
        }
        if (res.fieldErrors) setFieldErrors({ index: res.index ?? 0, errors: res.fieldErrors });
        toast.error(res.error);
        return false;
      } catch {
        toast.error(t("toast.error"));
        return false;
      } finally {
        setPending(false);
      }
    },
    [router, redirectTo, t],
  );

  const dialog = (
    <Dialog open={Boolean(dups)} onOpenChange={(o) => !o && setDups(null)}>
      <DialogContent title={t("dup.title")} description={t("dup.body")}>
        <ul className="mb-5 grid gap-2">
          {dups?.list.map((d, i) => (
            <li key={`${d.expense.id}-${i}`} className="flex items-center gap-3 rounded-2xl border bg-warning-soft/50 p-3">
              <AlertTriangle className="size-5 shrink-0 text-warning" />
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-medium">{d.expense.merchant || d.expense.description || "—"}</div>
                <div className="text-xs text-muted-foreground">
                  {formatDateLabel(d.expense.date, lang)} · {t(`dup.${d.level}`)}
                </div>
              </div>
              <div className="tabular text-sm font-semibold">{formatMoney(d.expense.amountCents)}</div>
            </li>
          ))}
        </ul>
        <div className="grid grid-cols-2 gap-2">
          <Button variant="outline" onClick={() => setDups(null)}>
            {t("dup.goBack")}
          </Button>
          <Button
            disabled={pending}
            onClick={async () => {
              const inputs = dups!.inputs.map((x) => ({ ...x, confirmDuplicate: true }));
              setDups(null);
              await save(inputs);
            }}
          >
            {t("dup.saveAnyway")}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );

  return { save, pending, dialog, fieldErrors };
}
