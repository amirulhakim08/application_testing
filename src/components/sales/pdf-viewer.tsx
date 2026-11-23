"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, Download, Loader2, Printer, Share2 } from "lucide-react";
import { toast } from "sonner";
import { useI18n } from "@/components/providers";
import { Button, buttonVariants } from "@/components/ui/button";
import { Select } from "@/components/ui/input";

type Kind = "quotation" | "invoice" | "receipt" | "delivery-order";
const TEMPLATES = ["classic", "modern", "navy"] as const;
const LABEL = { ms: { classic: "Klasik", modern: "Moden", navy: "Navy" }, en: { classic: "Classic", modern: "Modern", navy: "Navy" } } as const;

/**
 * In-app PDF page: renders the document on the device (pdf.js) with our own Back / Share / Download bar, because
 * opening a PDF in a new tab leaves phones (and installed apps) without a way back or a share button.
 */
export function PdfViewer({
  kind,
  id,
  number,
  businessName,
  defaultTemplate,
  backHref,
}: {
  kind: Kind;
  id: string;
  number: string;
  businessName: string;
  defaultTemplate: string;
  backHref: string;
}) {
  const { t, lang } = useI18n();
  const router = useRouter();
  const [template, setTemplate] = React.useState(TEMPLATES.includes(defaultTemplate as "modern") ? defaultTemplate : "modern");
  const [file, setFile] = React.useState<File | null>(null);
  const [state, setState] = React.useState<"loading" | "ready" | "error">("loading");
  const [canShareFiles, setCanShareFiles] = React.useState(false);
  const pagesRef = React.useRef<HTMLDivElement>(null);
  const url = `/api/documents/${kind}/${id}/pdf?template=${template}`;

  // Download the PDF once per template choice.
  React.useEffect(() => {
    let cancelled = false;
    setState("loading");
    (async () => {
      try {
        const res = await fetch(url, { cache: "no-store" });
        if (!res.ok) throw new Error(String(res.status));
        const name = /filename="([^"]+)"/.exec(res.headers.get("content-disposition") ?? "")?.[1] ?? `${number}.pdf`;
        const f = new File([await res.blob()], name, { type: "application/pdf" });
        if (cancelled) return;
        setFile(f);
        setCanShareFiles(typeof navigator !== "undefined" && !!navigator.canShare?.({ files: [f] }));
      } catch {
        if (!cancelled) setState("error");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [url, number]);

  // Draw every page into a canvas sized to the screen.
  React.useEffect(() => {
    if (!file || !pagesRef.current) return;
    let cancelled = false;
    const box = pagesRef.current;
    (async () => {
      try {
        const pdfjs = await import("pdfjs-dist");
        pdfjs.GlobalWorkerOptions.workerSrc = "/pdfjs/pdf.worker.min.mjs";
        const doc = await pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise;
        if (cancelled) return;
        box.replaceChildren();
        const cssWidth = Math.min(box.clientWidth || 800, 900);
        const dpr = Math.min(window.devicePixelRatio || 1, 3);
        for (let n = 1; n <= doc.numPages; n++) {
          const page = await doc.getPage(n);
          if (cancelled) return;
          const base = page.getViewport({ scale: 1 });
          const viewport = page.getViewport({ scale: (cssWidth / base.width) * dpr });
          const canvas = document.createElement("canvas");
          canvas.width = Math.floor(viewport.width);
          canvas.height = Math.floor(viewport.height);
          canvas.style.width = "100%";
          canvas.className = "block rounded-lg bg-white shadow-md ring-1 ring-black/5";
          canvas.setAttribute("role", "img");
          canvas.setAttribute("aria-label", `${number} — ${n}/${doc.numPages}`);
          box.appendChild(canvas);
          await page.render({ canvasContext: canvas.getContext("2d")!, viewport }).promise;
        }
        if (!cancelled) setState("ready");
      } catch {
        if (!cancelled) setState("error");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [file, number]);

  const back = () => {
    if (window.history.length > 1) router.back();
    else router.push(backHref);
  };

  const share = async () => {
    if (!file) return;
    try {
      await navigator.share({ files: [file], title: number, text: t("pdf.shareText", { n: number, b: businessName }) });
    } catch (e) {
      if ((e as Error).name !== "AbortError") toast.error(t("pdf.error"));
    }
  };

  const print = () => {
    if (!file) return;
    const blobUrl = URL.createObjectURL(file);
    window.open(blobUrl, "_blank", "noopener");
    setTimeout(() => URL.revokeObjectURL(blobUrl), 60_000);
  };

  return (
    <div className="grid gap-3">
      <div className="sticky top-[calc(env(safe-area-inset-top)+3.75rem)] z-20 -mx-4 flex flex-wrap items-center gap-2 border-b bg-background/90 px-4 py-2 backdrop-blur lg:top-0 lg:mx-0 lg:rounded-2xl lg:border">
        <Button variant="ghost" onClick={back}>
          <ArrowLeft /> {t("pdf.back")}
        </Button>
        <span className="mr-auto truncate font-semibold">{number}</span>
        <Select aria-label={t("pdf.template")} className="h-10 w-auto" value={template} onChange={(e) => setTemplate(e.target.value)}>
          {TEMPLATES.map((x) => (
            <option key={x} value={x}>
              {LABEL[lang][x]}
            </option>
          ))}
        </Select>
        {canShareFiles ? (
          <Button onClick={share} disabled={!file}>
            <Share2 /> {t("pdf.share")}
          </Button>
        ) : (
          <Button variant="outline" onClick={print} disabled={!file}>
            <Printer /> {t("pdf.print")}
          </Button>
        )}
        <a href={`${url}&download=1`} className={buttonVariants({ variant: "outline", size: "icon" })} aria-label={t("pdf.download")} title={t("pdf.download")}>
          <Download />
        </a>
      </div>

      {state === "loading" && (
        <p className="flex items-center justify-center gap-2 py-16 text-sm text-muted-foreground" role="status">
          <Loader2 className="size-4 animate-spin" /> {t("pdf.loading")}
        </p>
      )}
      {state === "error" && (
        <p className="py-16 text-center text-sm text-destructive" role="alert">
          {t("pdf.error")}
        </p>
      )}
      <div ref={pagesRef} className="mx-auto grid w-full max-w-[900px] gap-4 pb-6" data-testid="pdf-pages" />
    </div>
  );
}
