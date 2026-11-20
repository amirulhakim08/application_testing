"use client";

import * as React from "react";
import { FileUp, Loader2, Paperclip, X } from "lucide-react";
import { useI18n } from "@/components/providers";
import { prepareProof } from "@/lib/payment-proof-client";
import { parsePaymentProof, type PaymentProofReading } from "@/lib/ocr/parse-payment-proof";

/**
 * Optional proof of payment. Images are read on the device (no upload needed for reading) to suggest the amount,
 * date and reference. The file itself is uploaded only after the payment is saved.
 */
export function PaymentProofField({ file, onFile, onRead }: { file: File | null; onFile: (f: File | null) => void; onRead?: (r: PaymentProofReading) => void }) {
  const { t } = useI18n();
  const inputRef = React.useRef<HTMLInputElement>(null);
  const [status, setStatus] = React.useState<"idle" | "reading" | "read" | "unread" | "error">("idle");
  const [message, setMessage] = React.useState("");
  const runId = React.useRef(0);

  const choose = async (picked: File | undefined) => {
    if (!picked) return;
    const prepared = await prepareProof(picked);
    if (!prepared.ok) {
      setStatus("error");
      setMessage(prepared.reason === "type" ? t("proof.badType") : t("proof.tooBig"));
      return;
    }
    onFile(prepared.file);
    if (!onRead || prepared.file.type === "application/pdf") {
      setStatus("idle");
      return;
    }
    const id = ++runId.current;
    setStatus("reading");
    try {
      const { ocrReceipt } = await import("@/lib/ocr/tesseract-client");
      const { text } = await ocrReceipt(prepared.file);
      if (id !== runId.current) return;
      const r = parsePaymentProof(text);
      const found = [r.amountCents !== null, r.date !== null, r.reference !== null].filter(Boolean).length;
      setStatus(found ? "read" : "unread");
      if (found) onRead(r);
    } catch {
      if (id === runId.current) setStatus("unread");
    }
  };

  return (
    <div className="grid gap-1.5">
      <span className="text-sm font-medium">
        {t("proof.label")} <span className="text-[11px] text-muted-foreground">({t("form.optional")})</span>
      </span>
      <input
        ref={inputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp,application/pdf"
        className="sr-only"
        aria-label={t("proof.label")}
        data-testid="proof-input"
        onChange={(e) => {
          void choose(e.target.files?.[0]);
          e.target.value = "";
        }}
      />
      {file ? (
        <div className="flex items-center gap-3 rounded-2xl border bg-muted/40 px-4 py-3 text-sm">
          <Paperclip className="size-4 shrink-0 text-muted-foreground" aria-hidden />
          <span className="min-w-0 flex-1 truncate">{file.name}</span>
          {status === "reading" && <Loader2 className="size-4 animate-spin text-muted-foreground" aria-label={t("proof.reading")} />}
          <button
            type="button"
            className="grid size-8 place-items-center rounded-full text-muted-foreground hover:bg-muted"
            aria-label={t("proof.remove")}
            onClick={() => {
              runId.current++;
              onFile(null);
              setStatus("idle");
            }}
          >
            <X className="size-4" />
          </button>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          className="flex min-h-14 items-center gap-3 rounded-2xl border border-dashed border-input px-4 py-3 text-left text-sm hover:bg-muted/50"
        >
          <FileUp className="size-5 shrink-0 text-primary" aria-hidden />
          <span>{t("proof.choose")}</span>
        </button>
      )}
      <p className="px-1 text-xs text-muted-foreground" aria-live="polite">
        {status === "reading"
          ? t("proof.reading")
          : status === "read"
            ? t("proof.filled")
            : status === "unread"
              ? t("proof.unread")
              : status === "error"
                ? <span className="text-destructive">{message}</span>
                : onRead
                  ? t("proof.hint")
                  : null}
      </p>
    </div>
  );
}
