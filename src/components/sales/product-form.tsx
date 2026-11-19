"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Loader2, Pencil, Plus } from "lucide-react";
import { toast } from "sonner";
import { useI18n } from "@/components/providers";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Input, Select, Textarea } from "@/components/ui/input";
import { Field } from "@/components/app/business-forms";
import { saveProduct, type ProductInput } from "@/app/actions/sales";

export function ProductDialog({ id, initial, defaultTaxRate }: { id?: string; initial?: ProductInput; defaultTaxRate: string }) {
  const { t } = useI18n();
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const blank: ProductInput = { kind: "service", name: "", unit: "unit", price: "", taxRate: defaultTaxRate, active: true };
  const [v, setV] = React.useState<ProductInput>(initial ?? blank);
  const [errors, setErrors] = React.useState<Record<string, string>>({});
  const [pending, start] = React.useTransition();
  const set = (k: keyof ProductInput) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => setV({ ...v, [k]: e.target.value });
  return (
    <>
      {id ? (
        <Button size="icon-sm" variant="ghost" aria-label={`${t("c.edit")} ${initial?.name ?? ""}`} onClick={() => (setV(initial ?? blank), setErrors({}), setOpen(true))}>
          <Pencil />
        </Button>
      ) : (
        <Button onClick={() => (setV(blank), setErrors({}), setOpen(true))}>
          <Plus /> {t("prd.new")}
        </Button>
      )}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent title={id ? t("prd.edit") : t("prd.new")} className="sm:max-w-lg">
          <form
            className="grid gap-4"
            onSubmit={(e) => {
              e.preventDefault();
              start(async () => {
                const r = await saveProduct(id ?? null, v);
                if (!r.ok) {
                  setErrors(r.fieldErrors ?? {});
                  toast.error(r.error);
                  return;
                }
                toast.success(t("common.saved"));
                setOpen(false);
                router.refresh();
              });
            }}
          >
            <div className="grid gap-4 sm:grid-cols-[1fr_9rem]">
              <Field id="prd-name" label={t("prd.name")} error={errors.name}>
                <Input id="prd-name" required maxLength={160} value={v.name} onChange={set("name")} aria-invalid={Boolean(errors.name)} />
              </Field>
              <Field id="prd-kind" label={t("prd.kind")}>
                <Select id="prd-kind" value={v.kind} onChange={set("kind")}>
                  <option value="service">{t("prd.service")}</option>
                  <option value="product">{t("prd.product")}</option>
                </Select>
              </Field>
            </div>
            <Field id="prd-desc" label={t("prd.description")} optional>
              <Textarea id="prd-desc" rows={2} maxLength={2000} value={v.description ?? ""} onChange={set("description")} />
            </Field>
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
              <Field id="prd-price" label={t("prd.price")} error={errors.price}>
                <Input id="prd-price" inputMode="decimal" required value={v.price} onChange={set("price")} aria-invalid={Boolean(errors.price)} />
              </Field>
              <Field id="prd-unit" label={t("prd.unit")} error={errors.unit}>
                <Input id="prd-unit" maxLength={20} list="prd-units" value={v.unit ?? ""} onChange={set("unit")} />
                <datalist id="prd-units">
                  {["unit", "pcs", "kg", "jam", "hari", "bulan", "projek", "set", "kotak"].map((u) => (
                    <option key={u} value={u} />
                  ))}
                </datalist>
              </Field>
              <Field id="prd-tax" label={t("prd.tax")} error={errors.taxRate}>
                <Input id="prd-tax" inputMode="decimal" value={v.taxRate} onChange={set("taxRate")} aria-invalid={Boolean(errors.taxRate)} />
              </Field>
              <Field id="prd-sku" label={t("prd.sku")} optional>
                <Input id="prd-sku" maxLength={60} value={v.sku ?? ""} onChange={set("sku")} />
              </Field>
            </div>
            <label className="flex min-h-11 items-center gap-3 text-sm">
              <input type="checkbox" className="size-5 accent-[var(--primary)]" checked={v.active ?? true} onChange={(e) => setV({ ...v, active: e.target.checked })} />
              {t("prd.active")}
            </label>
            <div className="flex justify-end gap-2">
              <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
                {t("c.cancel")}
              </Button>
              <Button type="submit" disabled={pending}>
                {pending && <Loader2 className="animate-spin" />}
                {t("common.save")}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
