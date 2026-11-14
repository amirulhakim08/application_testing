"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Camera, Loader2, Mic, PenLine, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { useI18n } from "@/components/providers";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { deleteExpense, updateExpense } from "@/app/actions/expenses";
import { ExpenseFields, draftToInput, type ExpenseDraft } from "./expense-fields";
import { ReceiptPreviewButton } from "./receipt-preview";
import { ReceiptAttach } from "./receipt-attach";

const METHOD = { receipt_scan: Camera, voice: Mic, manual: PenLine } as const;

export function EditForm({
  id,
  initial,
  entryMethod,
  receiptFileId,
}: {
  id: string;
  initial: ExpenseDraft;
  entryMethod: "receipt_scan" | "voice" | "manual";
  receiptFileId: string | null;
}) {
  const { t } = useI18n();
  const router = useRouter();
  const [draft, setDraft] = React.useState(initial);
  const [newReceipt, setNewReceipt] = React.useState<string | null>(null);
  const [pending, setPending] = React.useState(false);
  const [confirmDelete, setConfirmDelete] = React.useState(false);
  const [errors, setErrors] = React.useState<Record<string, string>>({});
  const Icon = METHOD[entryMethod];

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setPending(true);
    const res = await updateExpense(id, draftToInput(draft, { entryMethod, receiptFileId: newReceipt ?? receiptFileId }));
    setPending(false);
    if (res.ok) {
      toast.success(t("toast.updated"));
      router.push("/expenses");
      router.refresh();
    } else {
      if ("fieldErrors" in res && res.fieldErrors) setErrors(res.fieldErrors);
      toast.error(res.error);
    }
  };

  const remove = async () => {
    setPending(true);
    const res = await deleteExpense(id);
    setPending(false);
    setConfirmDelete(false);
    if (res.ok) {
      toast.success(t("toast.deleted"));
      router.push("/expenses");
      router.refresh();
    } else toast.error(t("toast.error"));
  };

  return (
    <form onSubmit={submit} className="grid gap-6">
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant="outline">
          <Icon /> {t(`method.${entryMethod}`)}
        </Badge>
        {receiptFileId && !newReceipt && <ReceiptPreviewButton receiptFileId={receiptFileId} variant="ghost" />}
      </div>
      <ExpenseFields
        draft={draft}
        onChange={(p) => setDraft((d) => ({ ...d, ...p }))}
        errors={errors}
        showMoreInitially
        idPrefix="edit"
        extra={!receiptFileId ? <ReceiptAttach value={newReceipt} onChange={setNewReceipt} /> : undefined}
      />
      <div className="grid grid-cols-[auto_1fr] gap-2">
        <Button type="button" variant="outline" size="lg" onClick={() => setConfirmDelete(true)} className="text-destructive" aria-label={t("form.delete")}>
          <Trash2 />
        </Button>
        <Button type="submit" size="lg" disabled={pending || !draft.amount || !draft.workspaceId}>
          {pending && <Loader2 className="animate-spin" />}
          {t("form.update")}
        </Button>
      </div>
      <Dialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <DialogContent title={t("form.delete")} description={t("exp.deleteConfirm")}>
          <div className="grid grid-cols-2 gap-2">
            <Button variant="outline" onClick={() => setConfirmDelete(false)}>
              {t("form.cancel")}
            </Button>
            <Button variant="destructive" onClick={remove} disabled={pending}>
              {t("form.delete")}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </form>
  );
}
