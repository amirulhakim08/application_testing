"use client";

import Link from "next/link";
import { Download, FileText } from "lucide-react";
import { useI18n } from "@/components/providers";
import { buttonVariants } from "@/components/ui/button";

type Kind = "quotation" | "invoice" | "receipt" | "delivery-order";

/** Opens the in-app PDF view (Back / Share / Print / template) or downloads the PDF directly. */
export function PdfButtons({ kind, id, defaultTemplate, compact = false, label }: { kind: Kind; id: string; defaultTemplate: string; compact?: boolean; label?: string | null }) {
  const { t } = useI18n();
  const view = `/documents/${kind}/${id}`;
  if (compact) {
    return (
      <Link href={view} className={buttonVariants({ size: "sm", variant: "outline" })} aria-label={`PDF ${label ?? ""}`.trim()}>
        <FileText /> PDF
      </Link>
    );
  }
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Link href={view} className={buttonVariants({ variant: "outline" })}>
        <FileText /> {t("pdf.view")}
      </Link>
      <a href={`/api/documents/${kind}/${id}/pdf?template=${defaultTemplate}&download=1`} className={buttonVariants({ variant: "ghost" })}>
        <Download /> {t("pdf.download")}
      </a>
    </div>
  );
}
