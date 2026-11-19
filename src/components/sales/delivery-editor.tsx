"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Loader2, Plus, Trash2 } from "lucide-react";
import { useI18n } from "@/components/providers";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input, Select, Textarea } from "@/components/ui/input";
import { Field } from "@/components/app/business-forms";
import { saveDeliveryOrder } from "@/app/actions/sales";

interface Item {
  key: string;
  description: string;
  quantity: string;
  unit: string;
}
let seq = 0;
const k = () => `d${++seq}`;

export function DeliveryEditor({
  id,
  customers,
  products,
  initial,
}: {
  id: string | null;
  customers: Array<{ id: string; name: string; companyName: string | null; deliveryAddress: string | null }>;
  products: Array<{ id: string; name: string; unit: string }>;
  initial: { customerId: string | null; date: string; address: string; notes: string; items: Omit<Item, "key">[] };
}) {
  const { t } = useI18n();
  const router = useRouter();
  const [pending, start] = React.useTransition();
  const [customerId, setCustomerId] = React.useState(initial.customerId ?? "");
  const [date, setDate] = React.useState(initial.date);
  const [address, setAddress] = React.useState(initial.address);
  const [notes, setNotes] = React.useState(initial.notes);
  const [items, setItems] = React.useState<Item[]>(() =>
    initial.items.length ? initial.items.map((i) => ({ ...i, key: k() })) : [{ key: k(), description: "", quantity: "1", unit: "" }],
  );
  const [errors, setErrors] = React.useState<Record<string, string>>({});

  const update = (key: string, patch: Partial<Item>) => setItems((xs) => xs.map((x) => (x.key === key ? { ...x, ...patch } : x)));

  return (
    <form
      className="grid gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        start(async () => {
          const r = await saveDeliveryOrder(id, {
            customerId: customerId || null,
            issueDate: date,
            deliveryAddress: address,
            notes,
            items: items.map(({ description, quantity, unit }) => ({ description, quantity: quantity.trim(), unit })),
          });
          if (!r.ok) {
            setErrors(r.fieldErrors ?? {});
            toast.error(r.error);
            return;
          }
          toast.success(t("common.saved"));
          router.push(`/delivery-orders/${r.data!.id}`);
        });
      }}
    >
      <Card className="grid gap-4 p-5 sm:grid-cols-2">
        <Field id="do-customer" label={t("c.customer")} optional>
          <Select
            id="do-customer"
            value={customerId}
            onChange={(e) => {
              setCustomerId(e.target.value);
              const c = customers.find((x) => x.id === e.target.value);
              if (c?.deliveryAddress && !address) setAddress(c.deliveryAddress);
            }}
          >
            <option value="">—</option>
            {customers.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
                {c.companyName ? ` (${c.companyName})` : ""}
              </option>
            ))}
          </Select>
        </Field>
        <Field id="do-date" label={t("do.date")} error={errors.issueDate}>
          <Input id="do-date" type="date" required value={date} onChange={(e) => setDate(e.target.value)} />
        </Field>
        <div className="sm:col-span-2">
          <Field id="do-address" label={t("do.address")} optional>
            <Textarea id="do-address" rows={3} maxLength={500} value={address} onChange={(e) => setAddress(e.target.value)} />
          </Field>
        </div>
      </Card>

      <Card className="p-5">
        <h2 className="mb-3 font-semibold">{t("do.items")}</h2>
        {errors.items && <p className="mb-2 text-sm text-destructive">{errors.items}</p>}
        <div className="grid gap-3">
          {items.map((it, idx) => (
            <div key={it.key} className="grid gap-2 rounded-2xl border p-3 sm:grid-cols-[1fr_6rem_6rem_auto] sm:items-end">
              <Field id={`do-desc-${it.key}`} label={`${idx + 1}. ${t("doc.description")}`} error={errors[`items.${idx}.description`]}>
                <Input
                  id={`do-desc-${it.key}`}
                  list="do-products"
                  required
                  maxLength={2000}
                  value={it.description}
                  onChange={(e) => {
                    const p = products.find((x) => x.name === e.target.value);
                    update(it.key, { description: e.target.value, ...(p && !it.unit ? { unit: p.unit } : {}) });
                  }}
                />
              </Field>
              <Field id={`do-qty-${it.key}`} label={t("doc.qty")} error={errors[`items.${idx}.quantity`]}>
                <Input id={`do-qty-${it.key}`} inputMode="decimal" required value={it.quantity} onChange={(e) => update(it.key, { quantity: e.target.value })} />
              </Field>
              <Field id={`do-unit-${it.key}`} label={t("doc.unit")} optional>
                <Input id={`do-unit-${it.key}`} maxLength={20} value={it.unit} onChange={(e) => update(it.key, { unit: e.target.value })} />
              </Field>
              <Button type="button" variant="ghost" size="icon" aria-label={t("form.delete")} disabled={items.length === 1} onClick={() => setItems((xs) => xs.filter((x) => x.key !== it.key))}>
                <Trash2 />
              </Button>
            </div>
          ))}
        </div>
        <datalist id="do-products">
          {products.map((p) => (
            <option key={p.id} value={p.name} />
          ))}
        </datalist>
        <Button type="button" variant="outline" className="mt-3" onClick={() => setItems((xs) => [...xs, { key: k(), description: "", quantity: "1", unit: "" }])}>
          <Plus /> {t("doc.addItem")}
        </Button>
      </Card>

      <Card className="p-5">
        <Field id="do-notes" label={t("c.notes")} optional>
          <Textarea id="do-notes" rows={3} maxLength={2000} value={notes} onChange={(e) => setNotes(e.target.value)} />
        </Field>
      </Card>

      <div className="flex justify-end">
        <Button type="submit" size="lg" disabled={pending}>
          {pending && <Loader2 className="animate-spin" />}
          {t("c.saveDraft")}
        </Button>
      </div>
    </form>
  );
}
