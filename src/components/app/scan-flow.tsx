"use client";

import * as React from "react";
import { AlertTriangle, Camera, ImageUp, Info, Loader2, RotateCcw, Sparkles } from "lucide-react";
import { useI18n } from "@/components/providers";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { compressImage, validateImageFile } from "@/lib/client-image";
import { formatMoney } from "@/lib/money";
import { formatDateLabel } from "@/lib/dates";
import type { SanitizedReceipt } from "@/lib/receipt-sanitize";
import { ExpenseFields, draftToInput, type DraftField, type ExpenseDraft } from "./expense-fields";
import { useSaveExpenses } from "./use-save";
import { useAppData, useWorkspaceHelpers } from "./app-data";

interface ScanResponse {
  receiptFileId: string;
  extractionId: string | null;
  extraction: SanitizedReceipt | null;
  aiUnavailable?: boolean;
  aiError?: string;
  cached: boolean;
  duplicates: Array<{ level: string; expense: { id: string; amountCents: number; date: string; merchant: string | null; description: string | null } }>;
}

type Stage = { kind: "pick" } | { kind: "processing"; step: "optimizing" | "reading" } | { kind: "error"; message: string } | { kind: "review"; data: ScanResponse };

const AI_ERROR_TEXT: Record<string, string> = {
  rate_limited: "You've reached the hourly scan limit. Please enter details manually or try again later.",
  timeout: "Receipt reading took too long.",
  refused: "This image couldn't be processed.",
};

export function ScanFlow({ today }: { today: string }) {
  const { t, lang } = useI18n();
  const { ai } = useAppData();
  const { categoryByName } = useWorkspaceHelpers();
  const cameraRef = React.useRef<HTMLInputElement>(null);
  const uploadRef = React.useRef<HTMLInputElement>(null);
  const [stage, setStage] = React.useState<Stage>({ kind: "pick" });
  const [preview, setPreview] = React.useState<string | null>(null);
  const [draft, setDraft] = React.useState<ExpenseDraft | null>(null);
  const [suggestedCategory, setSuggestedCategory] = React.useState<string | null>(null);
  const [amountChecked, setAmountChecked] = React.useState(false);
  const [amountTouched, setAmountTouched] = React.useState(false);
  const { save, pending, dialog, fieldErrors } = useSaveExpenses();

  React.useEffect(() => () => void (preview && URL.revokeObjectURL(preview)), [preview]);

  const reset = () => {
    setStage({ kind: "pick" });
    setDraft(null);
    setAmountChecked(false);
    setAmountTouched(false);
    if (preview) URL.revokeObjectURL(preview);
    setPreview(null);
  };

  const onFile = async (file: File | undefined) => {
    if (!file) return;
    const invalid = validateImageFile(file);
    if (invalid) return setStage({ kind: "error", message: t("scan.formats") });
    setPreview(URL.createObjectURL(file));
    setStage({ kind: "processing", step: "optimizing" });
    try {
      const f = await compressImage(file);
      setStage({ kind: "processing", step: "reading" });
      const body = new FormData();
      body.set("image", f);
      const res = await fetch("/api/receipts/scan", { method: "POST", body });
      const json = (await res.json().catch(() => ({}))) as ScanResponse & { message?: string };
      if (!res.ok) return setStage({ kind: "error", message: json.message ?? t("scan.failed") });
      const x = json.extraction;
      setSuggestedCategory(x?.categoryName ?? null);
      setDraft({
        amount: x?.total.amountCents != null ? (x.total.amountCents / 100).toFixed(2) : "",
        workspaceId: null, // the user explicitly chooses Personal or Company
        categoryId: null,
        merchant: x?.merchant.value ?? "",
        description: x?.merchant.value ? (x.categoryName ? `${x.categoryName} at ${x.merchant.value}` : x.merchant.value) : x?.categoryName ?? "",
        date: x?.date.value ?? today,
        time: x?.time.value ?? "",
        notes: "",
        tax: x?.tax.value != null ? (x.tax.value / 100).toFixed(2) : "",
        discount: x?.discount.value != null ? (x.discount.value / 100).toFixed(2) : "",
      });
      setStage({ kind: "review", data: json });
    } catch {
      setStage({ kind: "error", message: t("scan.failed") });
    }
  };

  if (stage.kind === "pick" || stage.kind === "error") {
    return (
      <div className="grid gap-4">
        {!ai.receiptScan && (
          <Notice tone="info" icon={Info}>
            {t("scan.aiUnavailable")}
          </Notice>
        )}
        {stage.kind === "error" && (
          <Notice tone="warning" icon={AlertTriangle}>
            {stage.message}
          </Notice>
        )}
        <Card className="grid place-items-center gap-6 border-dashed px-6 py-12 text-center">
          <div className="grid size-20 place-items-center rounded-3xl bg-primary-soft text-primary">
            <Camera className="size-9" />
          </div>
          <p className="max-w-xs text-sm text-muted-foreground">{t("scan.formats")}</p>
          <div className="grid w-full max-w-xs gap-2">
            <Button size="lg" onClick={() => cameraRef.current?.click()}>
              <Camera /> {t("scan.take")}
            </Button>
            <Button size="lg" variant="outline" onClick={() => uploadRef.current?.click()}>
              <ImageUp /> {t("scan.upload")}
            </Button>
          </div>
        </Card>
        <input ref={cameraRef} type="file" accept="image/jpeg,image/png,image/webp" capture="environment" className="hidden" onChange={(e) => onFile(e.target.files?.[0])} />
        <input ref={uploadRef} type="file" accept="image/jpeg,image/png,image/webp" className="hidden" onChange={(e) => onFile(e.target.files?.[0])} />
      </div>
    );
  }

  if (stage.kind === "processing") {
    return (
      <Card className="grid place-items-center gap-5 overflow-hidden px-6 py-10 text-center">
        {preview && (
          <div className="relative h-56 w-40 overflow-hidden rounded-2xl border">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={preview} alt="" className="size-full object-cover opacity-80" />
            <div className="absolute inset-x-0 h-12 animate-[scan_1.6s_ease-in-out_infinite] bg-gradient-to-b from-transparent via-primary/40 to-transparent" />
          </div>
        )}
        <div className="flex items-center gap-2 text-sm font-medium">
          <Loader2 className="size-4 animate-spin" />
          {stage.step === "optimizing" ? t("scan.optimizing") : t("scan.processing")}
        </div>
        <style>{`@keyframes scan{0%{top:-3rem}100%{top:100%}}`}</style>
      </Card>
    );
  }

  const data = stage.data;
  const x = data.extraction;
  const status = x?.total.status ?? "missing";
  const aiAmount = Boolean(x && x.total.amountCents !== null);
  const requiresCheck = Boolean(x) && (status !== "ok" || x!.needsReview) && !amountTouched;
  const uncertain = new Set<DraftField>();
  if (x) {
    if (status !== "ok") uncertain.add("amount");
    if (x.merchant.value && x.merchant.confidence < 0.8) uncertain.add("merchant");
    if (!x.date.value || x.date.confidence < 0.8) uncertain.add("date");
    uncertain.add("categoryId");
  }

  const onChange = (patch: Partial<ExpenseDraft>) => {
    if (patch.amount !== undefined) setAmountTouched(true);
    setDraft((d) => {
      if (!d) return d;
      const next = { ...d, ...patch };
      // First workspace choice: apply the AI-suggested category for that workspace.
      if (patch.workspaceId && !d.workspaceId) next.categoryId = categoryByName(patch.workspaceId, suggestedCategory)?.id ?? null;
      return next;
    });
  };

  const canSave = draft && draft.amount && draft.workspaceId && (!requiresCheck || amountChecked);

  return (
    <form
      className="grid gap-5"
      onSubmit={(e) => {
        e.preventDefault();
        if (!draft || !canSave) return;
        void save([
          draftToInput(draft, {
            entryMethod: "receipt_scan",
            receiptFileId: data.receiptFileId,
            aiExtractionId: data.extractionId,
            items: x?.items,
            confirmDuplicate: false,
          }),
        ]);
      }}
    >
      <div className="flex items-start gap-4">
        {preview && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={preview} alt={t("form.receipt")} className="h-28 w-20 shrink-0 rounded-xl border object-cover" />
        )}
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5 text-sm font-semibold">
            <Sparkles className="size-4 text-primary" /> {t("scan.review")}
          </div>
          <p className="mt-1 text-sm text-muted-foreground">{t("scan.reviewHint")}</p>
          {x && x.items.length > 0 && <p className="mt-1 text-xs text-muted-foreground">{t("scan.items", { n: x.items.length })}</p>}
          <Button type="button" variant="ghost" size="sm" className="mt-1 -ml-3" onClick={reset}>
            <RotateCcw /> {t("scan.retake")}
          </Button>
        </div>
      </div>

      <div className="grid gap-2">
        {data.cached && <Notice tone="info" icon={Info}>{t("scan.cached")}</Notice>}
        {data.aiUnavailable && <Notice tone="info" icon={Info}>{t("scan.aiUnavailable")}</Notice>}
        {data.aiError && <Notice tone="warning" icon={AlertTriangle}>{AI_ERROR_TEXT[data.aiError] ?? t("scan.failed")} {t("scan.enterManually")}.</Notice>}
        {x && !x.isReceipt && <Notice tone="warning" icon={AlertTriangle}>{t("scan.notReceipt")}</Notice>}
        {x && status === "ambiguous" && <Notice tone="warning" icon={AlertTriangle}>{t("scan.ambiguous")}</Notice>}
        {x && status === "missing" && <Notice tone="warning" icon={AlertTriangle}>{t("scan.missingTotal")}</Notice>}
        {x && status === "review" && <Notice tone="warning" icon={AlertTriangle}>{t("scan.lowConfidence")}</Notice>}
        {x?.warnings.map((w) => (
          <Notice key={w} tone="info" icon={Info}>{w}</Notice>
        ))}
        {data.duplicates.length > 0 && (
          <Notice tone="warning" icon={AlertTriangle}>
            <span className="font-medium">{t("dup.title")}:</span>{" "}
            {data.duplicates.map((d) => `${d.expense.merchant ?? d.expense.description ?? ""} ${formatMoney(d.expense.amountCents)} (${formatDateLabel(d.expense.date, lang)}) — ${t(`dup.${d.level}` as "dup.likely")}`).join("; ")}
          </Notice>
        )}
      </div>

      {draft && (
        <ExpenseFields
          draft={draft}
          onChange={onChange}
          uncertain={uncertain}
          errors={fieldErrors?.errors}
          amountOptions={x?.total.options}
          showMoreInitially
          idPrefix="scan"
        />
      )}

      {requiresCheck && aiAmount && (
        <label className="flex items-center gap-3 rounded-2xl border border-warning/40 bg-warning-soft/60 p-4 text-sm font-medium">
          <input type="checkbox" className="size-5 accent-[var(--primary)]" checked={amountChecked} onChange={(e) => setAmountChecked(e.target.checked)} />
          {t("scan.confirmAmount")}
        </label>
      )}

      <div className="sticky bottom-24 z-10 lg:static">
        <Button type="submit" size="lg" className="w-full shadow-lg" disabled={pending || !canSave}>
          {pending && <Loader2 className="animate-spin" />}
          {pending ? t("form.saving") : t("form.save")}
        </Button>
      </div>
      {dialog}
    </form>
  );
}

export function Notice({ tone, icon: Icon, children }: { tone: "info" | "warning"; icon: React.ComponentType<{ className?: string }>; children: React.ReactNode }) {
  return (
    <div className={cn("flex gap-2.5 rounded-2xl p-3.5 text-sm", tone === "warning" ? "bg-warning-soft text-warning" : "bg-muted text-muted-foreground")} role={tone === "warning" ? "alert" : "status"}>
      <Icon className="mt-0.5 size-4 shrink-0" />
      <div>{children}</div>
    </div>
  );
}
