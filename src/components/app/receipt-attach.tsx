"use client";

import * as React from "react";
import { Paperclip, Loader2, X } from "lucide-react";
import { toast } from "sonner";
import { useI18n } from "@/components/providers";
import { Button } from "@/components/ui/button";
import { compressImage, validateImageFile } from "@/lib/client-image";
import { ReceiptPreviewButton } from "./receipt-preview";

/** Attach a receipt photo to a manual expense: stored privately, no AI processing. */
export function ReceiptAttach({ value, onChange }: { value: string | null; onChange: (id: string | null) => void }) {
  const { t } = useI18n();
  const ref = React.useRef<HTMLInputElement>(null);
  const [busy, setBusy] = React.useState(false);

  const onFile = async (file: File) => {
    const invalid = validateImageFile(file);
    if (invalid) return toast.error(t("scan.formats"));
    setBusy(true);
    try {
      const f = await compressImage(file);
      const body = new FormData();
      body.set("image", f);
      body.set("mode", "attach");
      const res = await fetch("/api/receipts/scan", { method: "POST", body });
      const json = await res.json();
      if (!res.ok || !json.receiptFileId) throw new Error(json.message ?? "upload");
      onChange(json.receiptFileId);
    } catch {
      toast.error(t("toast.error"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex items-center gap-2">
      <input ref={ref} type="file" accept="image/jpeg,image/png,image/webp" className="hidden" onChange={(e) => e.target.files?.[0] && onFile(e.target.files[0])} />
      {value ? (
        <>
          <ReceiptPreviewButton receiptFileId={value} />
          <Button type="button" variant="ghost" size="sm" onClick={() => onChange(null)}>
            <X /> {t("form.cancel")}
          </Button>
        </>
      ) : (
        <Button type="button" variant="outline" size="sm" onClick={() => ref.current?.click()} disabled={busy}>
          {busy ? <Loader2 className="animate-spin" /> : <Paperclip />} {t("form.attachReceipt")}
        </Button>
      )}
    </div>
  );
}
