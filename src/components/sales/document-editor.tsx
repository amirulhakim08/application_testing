"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Loader2, PackagePlus, Plus, ReceiptText, Trash2 } from "lucide-react";
import { useI18n } from "@/components/providers";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input, Select, Textarea } from "@/components/ui/input";
import { Field } from "@/components/app/business-forms";
import { CustomerPicker, type NewCustomer } from "./customer-picker";
import { PaymentProofField } from "./payment-proof-field";
import { uploadPaymentProof } from "@/lib/payment-proof-client";
import { formatMoney } from "@/lib/money";
import { priceDocument, rm, type ChargeInput } from "@/lib/documents";
import { cn } from "@/lib/utils";
import { todayKL } from "@/lib/dates";
import { recordCashSale, saveInvoice, saveQuotation } from "@/app/actions/sales";

export interface EditorItem {
  key: string;
  productId: string | null;
  description: string;
  quantity: string;
  unit: string;
  unitPrice: string;
  discount: string;
  taxRate: string;
}
export interface ManualCustomer {
  name: string;
  companyName: string;
  phone: string;
  email: string;
  billingAddress: string;
}
export interface EditorInitial {
  customerId: string | null;
  /** Typed customer details on a draft (customer not in the list). */
  customerManual?: Partial<ManualCustomer> | null;
  date: string;
  secondDate: string; // valid until (quotation) / due date (invoice)
  title?: string;
  customerPo?: string;
  paymentTerms?: string;
  notes: string;
  terms: string;
  items: Omit<EditorItem, "key">[];
  charges: ChargeInput[];
}
export interface EditorCustomer {
  id: string;
  name: string;
  companyName: string | null;
  phone: string | null;
}
export interface EditorProduct {
  id: string;
  name: string;
  description: string | null;
  unit: string;
  priceCents: number;
  taxRate: string;
}

const SALE_METHODS = ["cash", "duitnow", "ewallet", "card", "bank_transfer", "cheque", "other"] as const;

let keySeq = 0;
const newKey = () => `i${++keySeq}`;

export function DocumentEditor({
  kind,
  id,
  initial,
  customers: initialCustomers,
  products,
  defaultTaxRate,
  taxLabel,
  replaces,
}: {
  kind: "quotation" | "invoice" | "sale";
  id: string | null;
  initial: EditorInitial;
  customers: EditorCustomer[];
  products: EditorProduct[];
  defaultTaxRate: string;
  taxLabel: string;
  /** Direct sale only: correcting this receipt (it is voided when the new one is issued). */
  replaces?: { paymentId: string; number: string; method: string; reference: string } | null;
}) {
  const { t } = useI18n();
  const router = useRouter();
  const customers = initialCustomers;
  const [customerId, setCustomerId] = React.useState(initial.customerId ?? "");
  const [newCustomer, setNewCustomer] = React.useState<NewCustomer | null>(
    initial.customerManual?.name
      ? { name: initial.customerManual.name, phone: initial.customerManual.phone ?? "", billingAddress: initial.customerManual.billingAddress ?? "" }
      : null,
  );
  // Default: a new customer is also added to the customer list. An existing draft with typed details keeps them on the document only.
  const [saveCustomer, setSaveCustomer] = React.useState(!initial.customerManual?.name);
  const [date, setDate] = React.useState(initial.date);
  const [second, setSecond] = React.useState(initial.secondDate);
  const [title, setTitle] = React.useState(initial.title ?? "");
  const [customerPo, setCustomerPo] = React.useState(initial.customerPo ?? "");
  const [paymentTerms, setPaymentTerms] = React.useState(initial.paymentTerms ?? "");
  const [notes, setNotes] = React.useState(initial.notes);
  const [terms, setTerms] = React.useState(initial.terms);
  const blankItem = (): EditorItem => ({ key: newKey(), productId: null, description: "", quantity: "1", unit: "", unitPrice: "", discount: "", taxRate: defaultTaxRate });
  const [items, setItems] = React.useState<EditorItem[]>(() => (initial.items.length ? initial.items.map((i) => ({ ...i, key: newKey() })) : [blankItem()]));
  const [charges, setCharges] = React.useState<ChargeInput[]>(initial.charges);
  const [errors, setErrors] = React.useState<Record<string, string>>({});
  const [pending, start] = React.useTransition();
  const [catalogPick, setCatalogPick] = React.useState("");
  // Direct sale only: paid in full now. The request key is created once per form so a retry cannot record twice.
  const [method, setMethod] = React.useState<(typeof SALE_METHODS)[number]>(
    SALE_METHODS.includes(replaces?.method as "cash") ? (replaces!.method as (typeof SALE_METHODS)[number]) : "cash",
  );
  const [reference, setReference] = React.useState(replaces?.reference ?? "");
  const [requestKey] = React.useState(() => crypto.randomUUID());
  const isSale = kind === "sale";
  const [proofFile, setProofFile] = React.useState<File | null>(null);
  const [proofAmount, setProofAmount] = React.useState<number | null>(null);

  const totals = React.useMemo(() => priceDocument(items, charges), [items, charges]);
  const setItem = (key: string, patch: Partial<EditorItem>) => setItems((list) => list.map((i) => (i.key === key ? { ...i, ...patch } : i)));

  const addFromCatalog = (pid: string) => {
    const p = products.find((x) => x.id === pid);
    if (!p) return;
    const line: EditorItem = {
      key: newKey(),
      productId: p.id,
      description: p.description ? `${p.name}\n${p.description}` : p.name,
      quantity: "1",
      unit: p.unit,
      unitPrice: rm(p.priceCents),
      discount: "",
      taxRate: String(Number(p.taxRate)),
    };
    setItems((list) => {
      // Replace a single empty starter line instead of appending after it
      if (list.length === 1 && !list[0].description.trim() && !list[0].unitPrice.trim()) return [line];
      return [...list, line];
    });
    setCatalogPick("");
  };

  const submit = () => {
    start(async () => {
      const typed = !customerId && newCustomer?.name.trim() ? newCustomer : null;
      const common = {
        customerId: customerId || null,
        customerManual: typed ? { name: typed.name, phone: typed.phone, billingAddress: typed.billingAddress } : null,
        saveCustomer,
        notes,
        terms,
        items: items.map((i) => ({
          productId: i.productId,
          description: i.description,
          quantity: i.quantity.trim(),
          unit: i.unit,
          unitPrice: i.unitPrice.trim(),
          discount: i.discount.trim(),
          taxRate: i.taxRate.trim(),
        })),
        charges: charges.map((c) => ({ ...c, value: c.value.trim() })),
      };
      if (isSale) {
        const r = await recordCashSale({ ...common, saleDate: date, method, reference, requestKey, replacesPaymentId: replaces?.paymentId ?? null });
        if (!r.ok) {
          setErrors(r.fieldErrors ?? {});
          toast.error(r.error);
          return;
        }
        toast.success(t("pay.saved", { n: r.data!.receiptNumber }));
        if (proofFile && !(await uploadPaymentProof(r.data!.organizationId, r.data!.paymentId, proofFile))) toast.warning(t("proof.uploadFailed"));
        router.push(`/receipts/${r.data!.paymentId}`);
        router.refresh();
        return;
      }
      const r =
        kind === "quotation"
          ? await saveQuotation(id, { ...common, issueDate: date, validUntil: second, title })
          : await saveInvoice(id, { ...common, invoiceDate: date, dueDate: second, customerPo, paymentTerms });
      if (!r.ok) {
        setErrors(r.fieldErrors ?? {});
        toast.error(r.error);
        return;
      }
      toast.success(t("common.saved"));
      router.push(`/${kind === "quotation" ? "quotations" : "invoices"}/${r.data!.id}`);
      router.refresh();
    });
  };

  const lineErr = (idx: number, field: string) => errors[`items.${idx}.${field}`];

  return (
    <form
      className="grid gap-5 lg:grid-cols-[1fr_20rem] lg:items-start"
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      <div className="grid min-w-0 gap-5">
        {replaces && (
          <p className="rounded-2xl bg-warning-soft px-4 py-3 text-sm text-warning" role="status">
            {t("rc.correcting", { n: replaces.number })}
          </p>
        )}
        <Card className="grid gap-4 p-5">
          <CustomerPicker
            customers={customers}
            customerId={customerId}
            onSelect={setCustomerId}
            newCustomer={newCustomer}
            onNewCustomer={setNewCustomer}
            saveCustomer={saveCustomer}
            onSaveCustomer={setSaveCustomer}
            walkIn={isSale}
            required={!isSale}
            error={errors.customerId ?? errors["customerManual.name"]}
          />
          {isSale ? (
            <div className="grid gap-4 sm:grid-cols-3">
              <Field id="doc-date" label={t("pay.date")} error={errors.saleDate}>
                <Input id="doc-date" type="date" required max={todayKL()} value={date} onChange={(e) => setDate(e.target.value)} />
              </Field>
              <Field id="sale-method" label={t("pay.method")}>
                <Select id="sale-method" value={method} onChange={(e) => setMethod(e.target.value as (typeof SALE_METHODS)[number])}>
                  {SALE_METHODS.map((m) => (
                    <option key={m} value={m}>
                      {t(`pay.m.${m}`)}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field id="sale-ref" label={t("pay.reference")}>
                <Input id="sale-ref" maxLength={120} value={reference} onChange={(e) => setReference(e.target.value)} />
              </Field>
              <div className="sm:col-span-3">
                <PaymentProofField
                  file={proofFile}
                  onFile={(f) => {
                    setProofFile(f);
                    if (!f) setProofAmount(null);
                  }}
                  onRead={(r) => {
                    if (r.date && r.date <= todayKL()) setDate(r.date);
                    if (r.reference) setReference(r.reference);
                    setProofAmount(r.amountCents);
                  }}
                />
                {proofAmount !== null && totals.valid && totals.total > 0 && proofAmount !== totals.total && (
                  <p className="mt-1 px-1 text-xs text-warning">{t("proof.mismatch", { amt: formatMoney(proofAmount) })}</p>
                )}
              </div>
            </div>
          ) : (
            <div className="grid gap-4 sm:grid-cols-2">
              <Field id="doc-date" label={kind === "quotation" ? t("qt.issueDate") : t("inv.date")}>
                <Input id="doc-date" type="date" required value={date} onChange={(e) => setDate(e.target.value)} />
              </Field>
              <Field id="doc-second" label={kind === "quotation" ? t("qt.validUntil") : t("inv.due")} error={errors.validUntil ?? errors.dueDate}>
                <Input id="doc-second" type="date" min={date} value={second} onChange={(e) => setSecond(e.target.value)} />
              </Field>
            </div>
          )}
          {isSale ? null : kind === "quotation" ? (
            <Field id="doc-title" label={t("doc.title")} optional>
              <Input id="doc-title" maxLength={200} value={title} onChange={(e) => setTitle(e.target.value)} />
            </Field>
          ) : (
            <div className="grid gap-4 sm:grid-cols-2">
              <Field id="doc-po" label={t("inv.po")} optional>
                <Input id="doc-po" maxLength={80} value={customerPo} onChange={(e) => setCustomerPo(e.target.value)} />
              </Field>
              <Field id="doc-terms-short" label={t("inv.paymentTerms")} optional>
                <Input id="doc-terms-short" maxLength={200} placeholder="30 hari / 30 days" value={paymentTerms} onChange={(e) => setPaymentTerms(e.target.value)} />
              </Field>
            </div>
          )}
        </Card>

        <Card className="p-5">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-[15px] font-semibold">{t("doc.items")}</h2>
            {products.length > 0 && (
              <label className="flex items-center gap-2 text-sm">
                <PackagePlus className="size-4 text-muted-foreground" aria-hidden />
                <span className="sr-only">{t("doc.fromCatalog")}</span>
                <Select aria-label={t("doc.fromCatalog")} value={catalogPick} onChange={(e) => addFromCatalog(e.target.value)} className="h-10 w-56">
                  <option value="">{t("doc.fromCatalog")}…</option>
                  {products.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name} — {formatMoney(p.priceCents)}
                    </option>
                  ))}
                </Select>
              </label>
            )}
          </div>
          {errors.items && <p className="mb-3 text-sm text-warning">{errors.items}</p>}
          <ol className="grid gap-3">
            {items.map((it, idx) => {
              const line = totals.lines[idx];
              const bad = (f: string) => Boolean(lineErr(idx, f)) || (line?.error === f && (it.unitPrice !== "" || f !== "price"));
              return (
                <li key={it.key} className="rounded-2xl border bg-background/60 p-3">
                  <div className="flex items-start gap-2">
                    <span className="mt-3 w-5 text-xs font-semibold text-muted-foreground">{idx + 1}.</span>
                    <div className="grid min-w-0 flex-1 gap-2">
                      <Textarea
                        aria-label={`${t("doc.description")} ${idx + 1}`}
                        id={`item-${idx}-description`}
                        rows={it.description.includes("\n") ? 3 : 1}
                        className="min-h-12 py-3"
                        placeholder={t("doc.description")}
                        maxLength={2000}
                        value={it.description}
                        onChange={(e) => setItem(it.key, { description: e.target.value })}
                        aria-invalid={Boolean(lineErr(idx, "description"))}
                      />
                      <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
                        <MiniField label={t("doc.qty")} id={`item-${idx}-qty`} value={it.quantity} invalid={bad("quantity")} onChange={(v) => setItem(it.key, { quantity: v })} />
                        <MiniField label={t("doc.unit")} id={`item-${idx}-unit`} value={it.unit} inputMode="text" onChange={(v) => setItem(it.key, { unit: v })} />
                        <MiniField label={t("doc.price")} id={`item-${idx}-price`} value={it.unitPrice} invalid={bad("price")} onChange={(v) => setItem(it.key, { unitPrice: v })} />
                        <MiniField label={t("doc.discount")} id={`item-${idx}-discount`} value={it.discount} invalid={bad("discount")} onChange={(v) => setItem(it.key, { discount: v })} />
                        <MiniField label={`${taxLabel} %`} id={`item-${idx}-tax`} value={it.taxRate} invalid={bad("tax")} onChange={(v) => setItem(it.key, { taxRate: v })} />
                      </div>
                    </div>
                    <div className="flex flex-col items-end gap-1">
                      <Button type="button" size="icon-sm" variant="ghost" aria-label={`${t("doc.removeItem")} ${idx + 1}`} disabled={items.length === 1} onClick={() => setItems((l) => l.filter((x) => x.key !== it.key))}>
                        <Trash2 />
                      </Button>
                      <span className="tabular mt-auto text-sm font-semibold" aria-label={t("doc.lineTotal")}>
                        {formatMoney(line?.total ?? 0)}
                      </span>
                    </div>
                  </div>
                </li>
              );
            })}
          </ol>
          <Button type="button" variant="outline" className="mt-3" onClick={() => setItems((l) => [...l, blankItem()])}>
            <Plus /> {t("doc.addItem")}
          </Button>
        </Card>

        <Card className="p-5">
          <h2 className="mb-3 text-[15px] font-semibold">{t("doc.charges")}</h2>
          <div className="grid gap-2">
            {charges.map((c, i) => (
              <div key={i} className="grid grid-cols-[1fr_5.5rem_6rem_auto] items-center gap-2">
                <Input aria-label={t("doc.chargeLabel")} maxLength={60} value={c.label} onChange={(e) => setCharges((l) => l.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)))} />
                <Select aria-label="%/RM" value={c.kind} onChange={(e) => setCharges((l) => l.map((x, j) => (j === i ? { ...x, kind: e.target.value as "percent" | "fixed" } : x)))}>
                  <option value="percent">%</option>
                  <option value="fixed">RM</option>
                </Select>
                <Input aria-label={t("c.amount")} inputMode="decimal" value={c.value} onChange={(e) => setCharges((l) => l.map((x, j) => (j === i ? { ...x, value: e.target.value } : x)))} />
                <Button type="button" size="icon-sm" variant="ghost" aria-label={t("doc.removeItem")} onClick={() => setCharges((l) => l.filter((_, j) => j !== i))}>
                  <Trash2 />
                </Button>
              </div>
            ))}
          </div>
          <Button
            type="button"
            variant="ghost"
            className="mt-2"
            disabled={charges.length >= 10}
            onClick={() => setCharges((l) => [...l, { label: l.length ? "" : "Caj perkhidmatan", kind: "percent", value: l.length ? "" : "10" }])}
          >
            <Plus /> {t("doc.addCharge")}
          </Button>
        </Card>

        <Card className="grid gap-4 p-5">
          <Field id="doc-notes" label={t("c.notes")} optional>
            <Textarea id="doc-notes" rows={2} maxLength={2000} value={notes} onChange={(e) => setNotes(e.target.value)} />
          </Field>
          {!isSale && (
            <Field id="doc-tnc" label={t("c.terms")} optional>
              <Textarea id="doc-tnc" rows={3} maxLength={4000} value={terms} onChange={(e) => setTerms(e.target.value)} />
            </Field>
          )}
        </Card>
      </div>

      <Card className="grid gap-2 p-5 lg:sticky lg:top-6">
        <Row label={t("doc.subtotal")} value={totals.subtotal} />
        {totals.discountTotal > 0 && <Row label={t("doc.discountTotal")} value={-totals.discountTotal} />}
        {totals.charges.map((c, i) => (
          <Row key={i} label={`${c.label || t("doc.charges")}${c.kind === "percent" ? ` (${c.value || 0}%)` : ""}`} value={c.amount} />
        ))}
        <Row label={`${t("doc.taxTotal")} (${taxLabel})`} value={totals.taxTotal} />
        <div className="mt-1 flex items-baseline justify-between border-t pt-3">
          <span className="font-semibold">{t("doc.total")}</span>
          <span className="tabular text-2xl font-semibold">{formatMoney(totals.total)}</span>
        </div>
        {!totals.valid && <p className="text-xs text-warning">{t("doc.invalid")}</p>}
        <Button type="submit" size="lg" className="mt-3 w-full" disabled={pending}>
          {pending ? <Loader2 className="animate-spin" /> : isSale ? <ReceiptText /> : null}
          {isSale ? t("sale.issue") : t("c.saveDraft")}
        </Button>
        {isSale && <p className="text-center text-xs text-muted-foreground">{t("sale.hint")}</p>}
        {kind === "invoice" && <p className="text-center text-xs text-muted-foreground">{t("inv.notEinvoice")}</p>}
      </Card>
    </form>
  );
}

function Row({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex items-baseline justify-between gap-3 text-sm">
      <span className="text-muted-foreground">{label}</span>
      <span className="tabular">{value < 0 ? `− ${formatMoney(-value)}` : formatMoney(value)}</span>
    </div>
  );
}

function MiniField({
  label,
  id,
  value,
  onChange,
  invalid,
  inputMode = "decimal",
}: {
  label: string;
  id: string;
  value: string;
  onChange: (v: string) => void;
  invalid?: boolean;
  inputMode?: "decimal" | "text";
}) {
  return (
    <label htmlFor={id} className="grid gap-1">
      <span className="text-[11px] font-medium text-muted-foreground">{label}</span>
      <input
        id={id}
        inputMode={inputMode}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        aria-invalid={invalid || undefined}
        className={cn(
          "h-10 w-full rounded-lg border border-input bg-card px-2.5 text-sm tabular focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20",
          invalid && "border-warning ring-2 ring-warning/20",
        )}
      />
    </label>
  );
}
