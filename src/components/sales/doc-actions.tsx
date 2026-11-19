"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Archive, ArchiveRestore, ArrowRightLeft, Ban, Check, Copy, Loader2, MessageCircle, PackageCheck, Pencil, Send, Stamp, Trash2, Truck, Wallet, X } from "lucide-react";
import { useI18n } from "@/components/providers";
import { Button, buttonVariants } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Input, Select, Textarea } from "@/components/ui/input";
import { Field } from "@/components/app/business-forms";
import { formatMoney } from "@/lib/money";
import { todayKL } from "@/lib/dates";
import { reminderMessage, rm, whatsappLink, whatsappNumber } from "@/lib/documents";
import {
  cancelDeliveryOrder,
  convertQuotation,
  createDeliveryOrderFrom,
  issueDeliveryOrder,
  markDelivered,
  duplicateInvoice,
  duplicateQuotation,
  issueInvoice,
  recordPayment,
  setCustomerArchived,
  setQuotationStatus,
  voidInvoice,
  voidPayment,
} from "@/app/actions/sales";

type Result = { ok: boolean; error?: string; data?: unknown };

function useRun() {
  const router = useRouter();
  const [pending, start] = React.useTransition();
  const run = (fn: () => Promise<Result>, opts: { success?: string; go?: (data: unknown) => string | null } = {}) =>
    start(async () => {
      const r = await fn();
      if (!r.ok) {
        toast.error(r.error ?? "Error");
        return;
      }
      if (opts.success) toast.success(opts.success);
      const href = opts.go?.(r.data);
      if (href) router.push(href);
      router.refresh();
    });
  return { pending, run };
}

export function ArchiveCustomerButton({ id, archived }: { id: string; archived: boolean }) {
  const { t } = useI18n();
  const { pending, run } = useRun();
  return (
    <Button variant="ghost" disabled={pending} onClick={() => run(() => setCustomerArchived(id, !archived), { success: t("common.saved") })}>
      {archived ? <ArchiveRestore /> : <Archive />} {archived ? t("c.restore") : t("c.archive")}
    </Button>
  );
}

// ---------------------------------------------------------------- quotations

export function QuotationActions({
  id,
  status,
  convertedInvoiceId,
}: {
  id: string;
  status: "draft" | "sent" | "accepted" | "rejected";
  convertedInvoiceId: string | null;
}) {
  const { t } = useI18n();
  const { pending, run } = useRun();
  const converting = React.useRef(false);
  return (
    <div className="flex flex-wrap gap-2">
      {status === "draft" && (
        <Link href={`/quotations/${id}/edit`} className={buttonVariants({ variant: "outline" })}>
          <Pencil /> {t("c.edit")}
        </Link>
      )}
      {status === "draft" && (
        <Button variant="outline" disabled={pending} onClick={() => run(() => setQuotationStatus(id, "sent"), { success: t("common.saved") })}>
          <Send /> {t("qt.markSent")}
        </Button>
      )}
      {(status === "draft" || status === "sent") && !convertedInvoiceId && (
        <>
          <Button variant="outline" disabled={pending} onClick={() => run(() => setQuotationStatus(id, "accepted"), { success: t("common.saved") })}>
            <Check /> {t("qt.markAccepted")}
          </Button>
          <Button variant="ghost" disabled={pending} onClick={() => run(() => setQuotationStatus(id, "rejected"), { success: t("common.saved") })}>
            <X /> {t("qt.markRejected")}
          </Button>
        </>
      )}
      {convertedInvoiceId ? (
        <Link href={`/invoices/${convertedInvoiceId}`} className={buttonVariants()}>
          <ArrowRightLeft /> {t("qt.openInvoice")}
        </Link>
      ) : (
        status !== "rejected" && (
          <Button
            disabled={pending}
            onClick={() => {
              if (converting.current) return; // guard against double clicks; the server is idempotent too
              converting.current = true;
              run(() => convertQuotation(id).finally(() => (converting.current = false)), { go: (inv) => (inv ? `/invoices/${inv}` : null) });
            }}
          >
            {pending ? <Loader2 className="animate-spin" /> : <ArrowRightLeft />} {t("qt.convert")}
          </Button>
        )
      )}
      <Button variant="ghost" disabled={pending} onClick={() => run(() => duplicateQuotation(id), { go: (q) => (q ? `/quotations/${q}/edit` : null) })}>
        <Copy /> {t("c.duplicate")}
      </Button>
    </div>
  );
}

// ---------------------------------------------------------------- invoices

export function InvoiceActions({ id, status, outstandingCents, canPay }: { id: string; status: "draft" | "issued" | "void"; outstandingCents: number; canPay: boolean }) {
  const { t } = useI18n();
  const { pending, run } = useRun();
  const [confirmIssue, setConfirmIssue] = React.useState(false);
  const [voidOpen, setVoidOpen] = React.useState(false);
  const [reason, setReason] = React.useState("");
  return (
    <div className="flex flex-wrap gap-2">
      {status === "draft" && (
        <>
          <Link href={`/invoices/${id}/edit`} className={buttonVariants({ variant: "outline" })}>
            <Pencil /> {t("c.edit")}
          </Link>
          <Button disabled={pending} onClick={() => setConfirmIssue(true)}>
            <Stamp /> {t("inv.issue")}
          </Button>
        </>
      )}
      {status === "issued" && canPay && outstandingCents > 0 && <RecordPaymentDialog invoiceId={id} outstandingCents={outstandingCents} />}
      <Button variant="ghost" disabled={pending} onClick={() => run(() => duplicateInvoice(id), { go: (i) => (i ? `/invoices/${i}/edit` : null) })}>
        <Copy /> {t("c.duplicate")}
      </Button>
      {status !== "void" && (
        <Button variant="ghost" className="text-destructive" disabled={pending} onClick={() => setVoidOpen(true)}>
          {status === "draft" ? <Trash2 /> : <Ban />} {status === "draft" ? t("inv.discard") : t("inv.void")}
        </Button>
      )}

      <Dialog open={confirmIssue} onOpenChange={setConfirmIssue}>
        <DialogContent title={t("inv.issue")} description={t("inv.issueConfirm")}>
          <p className="mb-4 text-xs text-muted-foreground">{t("inv.notEinvoice")}</p>
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setConfirmIssue(false)}>
              {t("c.cancel")}
            </Button>
            <Button
              disabled={pending}
              onClick={() => {
                setConfirmIssue(false);
                run(() => issueInvoice(id), { success: t("common.saved") });
              }}
            >
              <Stamp /> {t("inv.issue")}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={voidOpen} onOpenChange={setVoidOpen}>
        <DialogContent title={status === "draft" ? t("inv.discard") : t("inv.void")} description={status === "draft" ? undefined : t("inv.voidHint")}>
          <form
            className="grid gap-4"
            onSubmit={(e) => {
              e.preventDefault();
              setVoidOpen(false);
              run(() => voidInvoice(id, reason || "Draft discarded"), { success: t("common.saved"), go: () => (status === "draft" ? "/invoices" : null) });
            }}
          >
            {status !== "draft" && (
              <Field id="void-reason" label={t("c.reason")}>
                <Input id="void-reason" required maxLength={300} value={reason} onChange={(e) => setReason(e.target.value)} />
              </Field>
            )}
            <div className="flex justify-end gap-2">
              <Button type="button" variant="ghost" onClick={() => setVoidOpen(false)}>
                {t("c.cancel")}
              </Button>
              <Button type="submit" variant="destructive" disabled={pending}>
                {status === "draft" ? t("inv.discard") : t("inv.void")}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}

const METHODS = ["cash", "bank_transfer", "duitnow", "card", "cheque", "ewallet", "other"] as const;

/** Records a payment. The request key is created once per dialog opening so retries cannot double-record. */
export function RecordPaymentDialog({
  invoiceId,
  outstandingCents,
  customers,
  standalone = false,
}: {
  invoiceId?: string;
  outstandingCents?: number;
  customers?: Array<{ id: string; name: string }>;
  standalone?: boolean;
}) {
  const { t } = useI18n();
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [pending, start] = React.useTransition();
  const [key, setKey] = React.useState("");
  const [amount, setAmount] = React.useState("");
  const [date, setDate] = React.useState(todayKL());
  const [method, setMethod] = React.useState<(typeof METHODS)[number]>("bank_transfer");
  const [reference, setReference] = React.useState("");
  const [description, setDescription] = React.useState("");
  const [customerId, setCustomerId] = React.useState("");
  const [errors, setErrors] = React.useState<Record<string, string>>({});

  const openDialog = () => {
    setKey(crypto.randomUUID());
    setAmount(outstandingCents ? rm(outstandingCents) : "");
    setDate(todayKL());
    setMethod(standalone ? "cash" : "bank_transfer");
    setReference("");
    setDescription("");
    setCustomerId("");
    setErrors({});
    setOpen(true);
  };

  return (
    <>
      <Button onClick={openDialog}>
        <Wallet /> {standalone ? t("pay.recordStandalone") : t("pay.record")}
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent title={standalone ? t("pay.recordStandalone") : t("pay.record")} description={outstandingCents ? t("pay.max", { amt: formatMoney(outstandingCents) }) : undefined}>
          <form
            className="grid gap-4"
            onSubmit={(e) => {
              e.preventDefault();
              start(async () => {
                const r = await recordPayment({
                  invoiceId: invoiceId ?? null,
                  customerId: customerId || null,
                  amount: amount.trim(),
                  date,
                  method,
                  reference,
                  description,
                  requestKey: key,
                });
                if (!r.ok) {
                  setErrors(r.fieldErrors ?? {});
                  toast.error(r.error);
                  return;
                }
                toast.success(t("pay.saved", { n: r.data!.receiptNumber }));
                setOpen(false);
                router.refresh();
              });
            }}
          >
            {standalone && (
              <>
                <Field id="pay-desc" label={t("pay.description")} error={errors.description}>
                  <Input id="pay-desc" required maxLength={240} value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Jualan kaunter" />
                </Field>
                {customers && customers.length > 0 && (
                  <Field id="pay-cust" label={t("c.customer")} optional>
                    <Select id="pay-cust" value={customerId} onChange={(e) => setCustomerId(e.target.value)}>
                      <option value="">—</option>
                      {customers.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.name}
                        </option>
                      ))}
                    </Select>
                  </Field>
                )}
              </>
            )}
            <div className="grid gap-4 sm:grid-cols-2">
              <Field id="pay-amount" label={t("pay.amount")} error={errors.amount}>
                <Input id="pay-amount" inputMode="decimal" required value={amount} onChange={(e) => setAmount(e.target.value)} aria-invalid={Boolean(errors.amount)} />
              </Field>
              <Field id="pay-date" label={t("pay.date")} error={errors.date}>
                <Input id="pay-date" type="date" required max={todayKL()} value={date} onChange={(e) => setDate(e.target.value)} />
              </Field>
            </div>
            <Field id="pay-method" label={t("pay.method")}>
              <Select id="pay-method" value={method} onChange={(e) => setMethod(e.target.value as (typeof METHODS)[number])}>
                {METHODS.map((m) => (
                  <option key={m} value={m}>
                    {t(`pay.m.${m}`)}
                  </option>
                ))}
              </Select>
            </Field>
            <Field id="pay-ref" label={t("pay.reference")}>
              <Input id="pay-ref" maxLength={120} value={reference} onChange={(e) => setReference(e.target.value)} />
            </Field>
            <div className="flex justify-end gap-2">
              <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
                {t("c.cancel")}
              </Button>
              <Button type="submit" disabled={pending}>
                {pending && <Loader2 className="animate-spin" />}
                {t("pay.record")}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}

export function VoidPaymentButton({ id }: { id: string }) {
  const { t } = useI18n();
  const { pending, run } = useRun();
  const [open, setOpen] = React.useState(false);
  const [reason, setReason] = React.useState("");
  return (
    <>
      <Button size="sm" variant="ghost" className="text-destructive" onClick={() => setOpen(true)}>
        <Ban /> {t("pay.void")}
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent title={t("pay.void")}>
          <form
            className="grid gap-4"
            onSubmit={(e) => {
              e.preventDefault();
              setOpen(false);
              run(() => voidPayment(id, reason), { success: t("common.saved") });
            }}
          >
            <Field id="vp-reason" label={t("c.reason")}>
              <Input id="vp-reason" required maxLength={300} value={reason} onChange={(e) => setReason(e.target.value)} />
            </Field>
            <div className="flex justify-end gap-2">
              <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
                {t("c.cancel")}
              </Button>
              <Button type="submit" variant="destructive" disabled={pending}>
                {t("pay.void")}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}

/** Prepares a WhatsApp reminder. The owner edits the text and sends it from their own WhatsApp. */
export function ReminderButton({ number, outstandingCents, phone, businessName }: { number: string; outstandingCents: number; phone: string | null; businessName: string }) {
  const { t, lang } = useI18n();
  const [open, setOpen] = React.useState(false);
  const [text, setText] = React.useState("");
  const hasPhone = Boolean(whatsappNumber(phone));
  return (
    <>
      <Button
        size="sm"
        variant="outline"
        onClick={() => {
          setText(reminderMessage({ lang, number, outstandingCents, businessName }));
          setOpen(true);
        }}
      >
        <MessageCircle /> {t("out.remind")}
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent title={t("out.remind")} description={t("out.remindHint")}>
          <div className="grid gap-4">
            <Textarea aria-label={t("out.remind")} rows={5} value={text} onChange={(e) => setText(e.target.value)} />
            {!hasPhone && <p className="text-xs text-warning">{t("out.noPhone")}</p>}
            <div className="flex flex-wrap justify-end gap-2">
              <Button
                variant="outline"
                onClick={async () => {
                  try {
                    await navigator.clipboard.writeText(text);
                    toast.success(t("c.copied"));
                  } catch {
                    toast.error("Clipboard unavailable");
                  }
                }}
              >
                <Copy /> {t("c.copy")}
              </Button>
              <a href={whatsappLink(phone, text)} target="_blank" rel="noopener noreferrer" className={buttonVariants()}>
                <MessageCircle /> {t("out.openWhatsapp")}
              </a>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

// ---------------------------------------------------------------- delivery orders

export function CreateDeliveryOrderButton({ source, id }: { source: "invoice" | "quotation"; id: string }) {
  const { t } = useI18n();
  const { pending, run } = useRun();
  return (
    <Button variant="outline" disabled={pending} onClick={() => run(() => createDeliveryOrderFrom(source, id), { go: (d) => (d ? `/delivery-orders/${d}/edit` : null) })}>
      <Truck /> {t("do.fromDoc")}
    </Button>
  );
}

export function DeliveryActions({ id, status }: { id: string; status: "draft" | "issued" | "delivered" | "cancelled" }) {
  const { t } = useI18n();
  const { pending, run } = useRun();
  const [deliverOpen, setDeliverOpen] = React.useState(false);
  const [cancelOpen, setCancelOpen] = React.useState(false);
  const [date, setDate] = React.useState(todayKL());
  const [receiver, setReceiver] = React.useState("");
  const [notes, setNotes] = React.useState("");
  const [reason, setReason] = React.useState("");
  return (
    <div className="flex flex-wrap gap-2">
      {status === "draft" && (
        <>
          <Link href={`/delivery-orders/${id}/edit`} className={buttonVariants({ variant: "outline" })}>
            <Pencil /> {t("c.edit")}
          </Link>
          <Button disabled={pending} onClick={() => run(() => issueDeliveryOrder(id), { success: t("common.saved") })}>
            <Stamp /> {t("do.issue")}
          </Button>
        </>
      )}
      {status === "issued" && (
        <Button disabled={pending} onClick={() => setDeliverOpen(true)}>
          <PackageCheck /> {t("do.markDelivered")}
        </Button>
      )}
      {(status === "draft" || status === "issued") && (
        <Button variant="ghost" className="text-destructive" disabled={pending} onClick={() => setCancelOpen(true)}>
          {status === "draft" ? <Trash2 /> : <Ban />} {status === "draft" ? t("do.discard") : t("do.cancel")}
        </Button>
      )}

      <Dialog open={deliverOpen} onOpenChange={setDeliverOpen}>
        <DialogContent title={t("do.markDelivered")}>
          <form
            className="grid gap-4"
            onSubmit={(e) => {
              e.preventDefault();
              setDeliverOpen(false);
              run(() => markDelivered(id, date, receiver, notes), { success: t("common.saved") });
            }}
          >
            <Field id="dl-date" label={t("do.deliveredDate")}>
              <Input id="dl-date" type="date" required max={todayKL()} value={date} onChange={(e) => setDate(e.target.value)} />
            </Field>
            <Field id="dl-recv" label={t("do.receiver")} optional>
              <Input id="dl-recv" maxLength={120} value={receiver} onChange={(e) => setReceiver(e.target.value)} />
            </Field>
            <Field id="dl-notes" label={t("do.deliveryNotes")} optional>
              <Textarea id="dl-notes" rows={2} maxLength={1000} value={notes} onChange={(e) => setNotes(e.target.value)} />
            </Field>
            <div className="flex justify-end gap-2">
              <Button type="button" variant="ghost" onClick={() => setDeliverOpen(false)}>
                {t("c.cancel")}
              </Button>
              <Button type="submit" disabled={pending}>
                <PackageCheck /> {t("do.markDelivered")}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={cancelOpen} onOpenChange={setCancelOpen}>
        <DialogContent title={status === "draft" ? t("do.discard") : t("do.cancel")}>
          <form
            className="grid gap-4"
            onSubmit={(e) => {
              e.preventDefault();
              setCancelOpen(false);
              run(() => cancelDeliveryOrder(id, reason || "Draft discarded"), { success: t("common.saved"), go: () => (status === "draft" ? "/delivery-orders" : null) });
            }}
          >
            {status !== "draft" && (
              <Field id="dc-reason" label={t("c.reason")}>
                <Input id="dc-reason" required maxLength={300} value={reason} onChange={(e) => setReason(e.target.value)} />
              </Field>
            )}
            <div className="flex justify-end gap-2">
              <Button type="button" variant="ghost" onClick={() => setCancelOpen(false)}>
                {t("c.cancel")}
              </Button>
              <Button type="submit" variant="destructive" disabled={pending}>
                {status === "draft" ? t("do.discard") : t("do.cancel")}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
