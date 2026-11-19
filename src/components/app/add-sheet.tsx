"use client";

import Link from "next/link";
import { Camera, Mic, PenLine, ScrollText, ChevronRight } from "lucide-react";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { useI18n } from "@/components/providers";

export const CAPTURE_OPTIONS = [
  { href: "/receipts/new", icon: ScrollText, title: "sale.newShort", hint: "sale.subtitle" },
  { href: "/add/scan", icon: Camera, title: "add.scan", hint: "add.scan.hint" },
  { href: "/add/voice", icon: Mic, title: "add.voice", hint: "add.voice.hint" },
  { href: "/add/manual", icon: PenLine, title: "add.manual", hint: "add.manual.hint" },
] as const;

export function AddSheet({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const { t } = useI18n();
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent title={t("add.title")}>
        <div className="grid gap-2">
          {CAPTURE_OPTIONS.map((o) => (
            <Link
              key={o.href}
              href={o.href}
              onClick={() => onOpenChange(false)}
              className="group flex items-center gap-4 rounded-2xl border bg-background/50 p-4 transition-colors hover:bg-muted active:scale-[0.99]"
            >
              <span className="grid size-12 place-items-center rounded-2xl bg-primary text-primary-foreground">
                <o.icon className="size-5" />
              </span>
              <span className="flex-1">
                <span className="block font-semibold">{t(o.title)}</span>
                <span className="block text-sm text-muted-foreground">{t(o.hint)}</span>
              </span>
              <ChevronRight className="size-5 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
            </Link>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}
