import { Badge } from "@/components/ui/badge";
import type { TFunction } from "@/lib/i18n";
import type { InvoiceSummary } from "@/lib/sales";
import type { QuotationDisplayStatus } from "@/lib/documents";

const QT_VARIANT: Record<QuotationDisplayStatus, "default" | "info" | "success" | "danger" | "warning"> = {
  draft: "default",
  sent: "info",
  accepted: "success",
  rejected: "danger",
  expired: "warning",
};

export function QuotationBadge({ status, t }: { status: QuotationDisplayStatus; t: TFunction }) {
  return <Badge variant={QT_VARIANT[status]}>{t(`qt.status.${status}`)}</Badge>;
}

/** Lifecycle (draft/void) or payment status, plus an overdue badge that never hides "partially paid". */
export function InvoiceBadges({ inv, t }: { inv: Pick<InvoiceSummary, "status" | "paymentStatus" | "daysOverdue">; t: TFunction }) {
  if (inv.status === "draft") return <Badge>{t("inv.lifecycle.draft")}</Badge>;
  if (inv.status === "void") return <Badge variant="danger">{t("inv.lifecycle.void")}</Badge>;
  return (
    <span className="inline-flex flex-wrap gap-1">
      <Badge variant={inv.paymentStatus === "paid" ? "success" : inv.paymentStatus === "partial" ? "accent" : "warning"}>{t(`inv.pay.${inv.paymentStatus}`)}</Badge>
      {inv.daysOverdue > 0 && <Badge variant="danger">{t("inv.overdue", { n: inv.daysOverdue })}</Badge>}
    </span>
  );
}
