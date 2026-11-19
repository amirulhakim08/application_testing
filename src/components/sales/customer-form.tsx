"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Loader2, Plus, Pencil } from "lucide-react";
import { toast } from "sonner";
import { useI18n } from "@/components/providers";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Input, Textarea } from "@/components/ui/input";
import { Field } from "@/components/app/business-forms";
import { saveCustomer, type CustomerInput } from "@/app/actions/sales";

export interface CustomerFormValue {
  id?: string;
  name: string;
  companyName?: string | null;
  registrationNo?: string | null;
  phone?: string | null;
  email?: string | null;
  billingAddress?: string | null;
  deliveryAddress?: string | null;
  notes?: string | null;
}

export function CustomerFields({ value, onChange, errors }: { value: CustomerInput; onChange: (v: CustomerInput) => void; errors: Record<string, string> }) {
  const { t } = useI18n();
  const set = (k: keyof CustomerInput) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => onChange({ ...value, [k]: e.target.value });
  return (
    <div className="grid gap-4">
      <Field id="cus-name" label={t("cus.name")} error={errors.name}>
        <Input id="cus-name" required maxLength={160} value={value.name ?? ""} onChange={set("name")} aria-invalid={Boolean(errors.name)} />
      </Field>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field id="cus-company" label={t("cus.company")} optional>
          <Input id="cus-company" maxLength={160} value={value.companyName ?? ""} onChange={set("companyName")} />
        </Field>
        <Field id="cus-reg" label={t("cus.reg")} optional>
          <Input id="cus-reg" maxLength={40} value={value.registrationNo ?? ""} onChange={set("registrationNo")} />
        </Field>
        <Field id="cus-phone" label={t("cus.phone")} optional error={errors.phone}>
          <Input id="cus-phone" type="tel" maxLength={40} placeholder="012-345 6789" value={value.phone ?? ""} onChange={set("phone")} />
        </Field>
        <Field id="cus-email" label={t("cus.email")} optional error={errors.email}>
          <Input id="cus-email" type="email" maxLength={160} value={value.email ?? ""} onChange={set("email")} aria-invalid={Boolean(errors.email)} />
        </Field>
      </div>
      <Field id="cus-billing" label={t("cus.billing")} optional>
        <Textarea id="cus-billing" rows={2} maxLength={500} value={value.billingAddress ?? ""} onChange={set("billingAddress")} />
      </Field>
      <Field id="cus-delivery" label={t("cus.delivery")} optional>
        <Textarea id="cus-delivery" rows={2} maxLength={500} value={value.deliveryAddress ?? ""} onChange={set("deliveryAddress")} />
      </Field>
      <Field id="cus-notes" label={t("c.notes")} optional>
        <Textarea id="cus-notes" rows={2} maxLength={1000} value={value.notes ?? ""} onChange={set("notes")} />
      </Field>
    </div>
  );
}

/** Create/edit customer in a dialog. `onSaved` receives the id (used by the document editor's quick add). */
export function CustomerDialog({
  initial,
  trigger,
  onSaved,
  open: openProp,
  onOpenChange,
}: {
  initial?: CustomerFormValue;
  trigger?: "new" | "edit" | null;
  onSaved?: (id: string, value: CustomerInput) => void;
  open?: boolean;
  onOpenChange?: (o: boolean) => void;
}) {
  const { t } = useI18n();
  const router = useRouter();
  const [openState, setOpenState] = React.useState(false);
  const open = openProp ?? openState;
  const setOpen = onOpenChange ?? setOpenState;
  const blank: CustomerInput = { name: "" };
  const [value, setValue] = React.useState<CustomerInput>(initial ?? blank);
  const [errors, setErrors] = React.useState<Record<string, string>>({});
  const [pending, start] = React.useTransition();
  React.useEffect(() => {
    if (open) {
      setValue(initial ?? blank);
      setErrors({});
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  return (
    <>
      {trigger === "new" && (
        <Button onClick={() => setOpen(true)}>
          <Plus /> {t("cus.new")}
        </Button>
      )}
      {trigger === "edit" && (
        <Button variant="outline" onClick={() => setOpen(true)}>
          <Pencil /> {t("c.edit")}
        </Button>
      )}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent title={initial?.id ? t("cus.edit") : t("cus.new")} className="sm:max-w-lg">
          <form
            className="grid gap-5"
            onSubmit={(e) => {
              e.preventDefault();
              start(async () => {
                const r = await saveCustomer(initial?.id ?? null, value);
                if (!r.ok) {
                  setErrors(r.fieldErrors ?? {});
                  toast.error(r.error);
                  return;
                }
                toast.success(t("common.saved"));
                setOpen(false);
                onSaved?.(r.data!.id, value);
                router.refresh();
              });
            }}
          >
            <CustomerFields value={value} onChange={setValue} errors={errors} />
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
