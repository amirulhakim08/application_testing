"use client";

import * as React from "react";
import { Download, Printer } from "lucide-react";
import { useI18n } from "@/components/providers";
import { buttonVariants } from "@/components/ui/button";
import { Select } from "@/components/ui/input";

type Kind = "quotation" | "invoice" | "receipt" | "delivery-order";
const TEMPLATES = ["classic", "modern", "navy"] as const;
const LABEL = { ms: { classic: "Klasik", modern: "Moden", navy: "Navy" }, en: { classic: "Classic", modern: "Modern", navy: "Navy" } } as const;

/** Opens the server-generated PDF in a new tab (print from the viewer) or downloads it. */
export function PdfButtons({ kind, id, defaultTemplate, compact = false, label }: { kind: Kind; id: string; defaultTemplate: string; compact?: boolean; label?: string | null }) {
  const { t, lang } = useI18n();
  const [template, setTemplate] = React.useState(TEMPLATES.includes(defaultTemplate as "modern") ? defaultTemplate : "modern");
  const base = `/api/documents/${kind}/${id}/pdf?template=${template}`;
  if (compact) {
    return (
      <a href={base} target="_blank" rel="noopener" className={buttonVariants({ size: "sm", variant: "outline" })} aria-label={`PDF ${label ?? ""}`.trim()}>
        <Printer /> PDF
      </a>
    );
  }
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Select aria-label={t("pdf.template")} className="h-10 w-auto" value={template} onChange={(e) => setTemplate(e.target.value)}>
        {TEMPLATES.map((x) => (
          <option key={x} value={x}>
            {t("pdf.template")}: {LABEL[lang][x]}
          </option>
        ))}
      </Select>
      <a href={base} target="_blank" rel="noopener" className={buttonVariants({ variant: "outline" })}>
        <Printer /> {t("pdf.view")}
      </a>
      <a href={`${base}&download=1`} className={buttonVariants({ variant: "ghost" })}>
        <Download /> {t("pdf.download")}
      </a>
    </div>
  );
}
