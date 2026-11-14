"use client";

import * as React from "react";
import { Receipt, Loader2 } from "lucide-react";
import { useI18n } from "@/components/providers";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";

/** Fetches a short-lived signed URL only when the user opens the preview. */
export function ReceiptPreviewButton({ receiptFileId, variant = "outline" }: { receiptFileId: string; variant?: "outline" | "ghost" }) {
  const { t } = useI18n();
  const [open, setOpen] = React.useState(false);
  const [url, setUrl] = React.useState<string | null>(null);
  const [state, setState] = React.useState<"idle" | "loading" | "missing">("idle");

  const show = async () => {
    setOpen(true);
    if (url) return;
    setState("loading");
    const res = await fetch(`/api/receipts/${receiptFileId}`);
    if (!res.ok) return setState("missing");
    setUrl((await res.json()).url);
    setState("idle");
  };

  return (
    <>
      <Button type="button" variant={variant} size="sm" onClick={show}>
        <Receipt /> {t("exp.viewReceipt")}
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent title={t("form.receipt")} className="sm:max-w-lg">
          {state === "loading" && <Loader2 className="mx-auto my-10 size-6 animate-spin text-muted-foreground" />}
          {state === "missing" && <p className="py-8 text-center text-sm text-muted-foreground">Receipt image is no longer stored (retention setting).</p>}
          {url && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={url} alt={t("form.receipt")} className="mx-auto max-h-[70dvh] rounded-xl object-contain" referrerPolicy="no-referrer" />
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
