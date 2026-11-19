import type { TFunction } from "@/lib/i18n";
import type { DocCharge, DocItem, DocTotals, PartySnapshot } from "@/lib/sales";
import { formatMoney } from "@/lib/money";
import { formatDateLabel } from "@/lib/dates";
import { Card } from "@/components/ui/card";

/** On-screen document summary (the printable PDF arrives in Phase 3). Values come from saved rows only. */
export function DocumentView({
  t,
  lang,
  party,
  meta,
  items,
  charges,
  totals,
  taxLabel,
  notes,
  terms,
}: {
  t: TFunction;
  lang: "ms" | "en";
  party: PartySnapshot | null;
  meta: Array<{ label: string; value: string | null }>;
  items: DocItem[];
  charges: DocCharge[];
  totals: DocTotals;
  taxLabel: string;
  notes: string | null;
  terms: string | null;
}) {
  return (
    <Card className="overflow-hidden">
      <div className="grid gap-4 border-b bg-muted/30 p-5 sm:grid-cols-2">
        <div>
          <div className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">{t("c.customer")}</div>
          {party?.name ? (
            <div className="mt-1 text-sm">
              <div className="font-semibold">{party.name}</div>
              {party.company_name && <div>{party.company_name}</div>}
              {party.billing_address && <div className="whitespace-pre-line text-muted-foreground">{party.billing_address}</div>}
              {[party.phone, party.email].filter(Boolean).length > 0 && <div className="text-muted-foreground">{[party.phone, party.email].filter(Boolean).join(" · ")}</div>}
            </div>
          ) : (
            <div className="mt-1 text-sm text-warning">{t("cus.choose")}</div>
          )}
        </div>
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm sm:justify-self-end">
          {meta
            .filter((m) => m.value)
            .map((m) => (
              <div key={m.label} className="contents">
                <dt className="text-muted-foreground">{m.label}</dt>
                <dd className="text-right font-medium">{m.value}</dd>
              </div>
            ))}
        </dl>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full min-w-[34rem] text-sm">
          <thead className="bg-primary text-primary-foreground">
            <tr>
              <th className="w-10 px-4 py-2.5 text-left font-semibold">#</th>
              <th className="px-2 py-2.5 text-left font-semibold">{t("doc.description")}</th>
              <th className="px-2 py-2.5 text-right font-semibold">{t("doc.qty")}</th>
              <th className="px-2 py-2.5 text-right font-semibold">{t("doc.price")}</th>
              <th className="px-2 py-2.5 text-right font-semibold">{taxLabel}</th>
              <th className="px-4 py-2.5 text-right font-semibold">{t("doc.lineTotal")}</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {items.map((i) => (
              <tr key={i.position} className="align-top">
                <td className="px-4 py-3 text-muted-foreground">{i.position}</td>
                <td className="whitespace-pre-line px-2 py-3">
                  {i.description}
                  {Number(i.discount) > 0 && <div className="text-xs text-muted-foreground">{t("doc.discount")}: {formatMoney(Math.round(Number(i.discount) * 100))}</div>}
                </td>
                <td className="tabular px-2 py-3 text-right">
                  {i.quantity}
                  {i.unit ? ` ${i.unit}` : ""}
                </td>
                <td className="tabular px-2 py-3 text-right">{i.unitPrice}</td>
                <td className="tabular px-2 py-3 text-right">{Number(i.taxRate) > 0 ? `${i.taxRate}%` : "—"}</td>
                <td className="tabular px-4 py-3 text-right font-medium">{formatMoney(i.lineSubtotal)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="grid gap-5 border-t p-5 sm:grid-cols-[1fr_18rem]">
        <div className="grid content-start gap-3 text-sm">
          {notes && (
            <div>
              <div className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">{t("c.notes")}</div>
              <p className="mt-1 whitespace-pre-line">{notes}</p>
            </div>
          )}
          {terms && (
            <div>
              <div className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">{t("c.terms")}</div>
              <p className="mt-1 whitespace-pre-line">{terms}</p>
            </div>
          )}
        </div>
        <dl className="grid gap-1.5 text-sm">
          <TotalRow label={t("doc.subtotal")} value={formatMoney(totals.subtotal)} />
          {totals.discountTotal > 0 && <TotalRow label={t("doc.discountTotal")} value={`− ${formatMoney(totals.discountTotal)}`} />}
          {charges.map((c, i) => (
            <TotalRow key={i} label={`${c.label}${c.kind === "percent" ? ` (${Number(c.value)}%)` : ""}`} value={formatMoney(c.amount)} />
          ))}
          <TotalRow label={`${t("doc.taxTotal")} (${taxLabel})`} value={formatMoney(totals.taxTotal)} />
          <div className="mt-1 flex items-baseline justify-between border-t pt-2">
            <dt className="font-semibold">{t("doc.total")}</dt>
            <dd className="tabular text-xl font-semibold">{formatMoney(totals.total)}</dd>
          </div>
        </dl>
      </div>
    </Card>
  );
}

function TotalRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="tabular">{value}</dd>
    </div>
  );
}

export function dateOrNull(d: string | null, lang: "ms" | "en") {
  return d ? formatDateLabel(d, lang, { day: "numeric", month: "short", year: "numeric" }) : null;
}
