"use client";

import * as React from "react";
import { Loader2 } from "lucide-react";
import { useI18n } from "@/components/providers";
import { Button } from "@/components/ui/button";
import { ExpenseFields, draftToInput, type ExpenseDraft } from "./expense-fields";
import { useSaveExpenses } from "./use-save";
import { useWorkspaceHelpers } from "./app-data";
import { ReceiptAttach } from "./receipt-attach";

export function ManualForm({ today }: { today: string }) {
  const { t } = useI18n();
  const { defaultWorkspaceId, defaultCategoryId } = useWorkspaceHelpers();
  const [receiptFileId, setReceiptFileId] = React.useState<string | null>(null);
  const [draft, setDraft] = React.useState<ExpenseDraft>(() => ({
    amount: "",
    workspaceId: defaultWorkspaceId,
    categoryId: defaultCategoryId(defaultWorkspaceId),
    merchant: "",
    description: "",
    date: today,
    time: "",
    notes: "",
    tax: "",
    discount: "",
  }));
  const { save, pending, dialog, fieldErrors } = useSaveExpenses();

  return (
    <form
      className="grid gap-6"
      onSubmit={(e) => {
        e.preventDefault();
        void save([draftToInput(draft, { entryMethod: "manual", receiptFileId })]);
      }}
    >
      <ExpenseFields
        draft={draft}
        onChange={(p) => setDraft((d) => ({ ...d, ...p }))}
        autoFocusAmount
        errors={fieldErrors?.errors}
        extra={<ReceiptAttach value={receiptFileId} onChange={setReceiptFileId} />}
      />
      <div className="sticky bottom-24 z-10 lg:static">
        <Button type="submit" size="lg" className="w-full shadow-lg" disabled={pending || !draft.amount || !draft.workspaceId}>
          {pending ? <Loader2 className="animate-spin" /> : null}
          {pending ? t("form.saving") : t("form.save")}
        </Button>
      </div>
      {dialog}
    </form>
  );
}
