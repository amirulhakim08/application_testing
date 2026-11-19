"use client";

import * as React from "react";
import { ImagePlus, Loader2, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { useI18n } from "@/components/providers";
import { Button } from "@/components/ui/button";
import { Input, Label, Select, Textarea } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import {
  removeLogo,
  updateBank,
  updateDocumentSettings,
  updateOrganization,
  uploadLogo,
  type BankInput,
  type BusinessInput,
  type DocumentSettingsInput,
} from "@/app/actions/organization";

type FieldErrors = Record<string, string>;

export function Field({
  id,
  label,
  optional,
  error,
  hint,
  children,
}: {
  id: string;
  label: string;
  optional?: boolean;
  error?: string;
  hint?: string;
  children: React.ReactNode;
}) {
  const { t } = useI18n();
  return (
    <div>
      <Label htmlFor={id}>
        {label} {optional && <span className="text-[11px]">({t("form.optional")})</span>}
      </Label>
      {children}
      {error ? (
        <p id={`${id}-error`} role="alert" className="mt-1 text-xs text-warning">
          {error}
        </p>
      ) : hint ? (
        <p className="mt-1 text-xs text-muted-foreground">{hint}</p>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------- business information
export function BusinessFields({
  value,
  onChange,
  errors,
}: {
  value: BusinessInput;
  onChange: (v: BusinessInput) => void;
  errors: FieldErrors;
}) {
  const { t } = useI18n();
  const set = (k: keyof BusinessInput) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => onChange({ ...value, [k]: e.target.value });
  const inv = (k: string) => (errors[k] ? { "aria-invalid": true, "aria-describedby": `biz-${k}-error` } : {});
  return (
    <div className="grid gap-4">
      <Field id="biz-name" label={t("onb.name")} error={errors.name}>
        <Input id="biz-name" required maxLength={120} autoComplete="organization" value={value.name ?? ""} onChange={set("name")} {...inv("name")} />
      </Field>
      <Field id="biz-registrationNo" label={t("onb.reg")} optional error={errors.registrationNo}>
        <Input id="biz-registrationNo" maxLength={40} placeholder="202601012345 (1234567-X)" value={value.registrationNo ?? ""} onChange={set("registrationNo")} {...inv("registrationNo")} />
      </Field>
      <Field id="biz-address" label={t("onb.address")} optional error={errors.address}>
        <Textarea id="biz-address" rows={3} maxLength={400} autoComplete="street-address" value={value.address ?? ""} onChange={set("address")} {...inv("address")} />
      </Field>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field id="biz-email" label={t("onb.email")} optional error={errors.email}>
          <Input id="biz-email" type="email" maxLength={160} autoComplete="email" value={value.email ?? ""} onChange={set("email")} {...inv("email")} />
        </Field>
        <Field id="biz-phone" label={t("onb.phone")} optional error={errors.phone}>
          <Input id="biz-phone" type="tel" maxLength={40} autoComplete="tel" placeholder="012-345 6789" value={value.phone ?? ""} onChange={set("phone")} {...inv("phone")} />
        </Field>
      </div>
      <Field id="biz-website" label={t("onb.website")} optional error={errors.website}>
        <Input id="biz-website" type="url" maxLength={200} placeholder="https://" value={value.website ?? ""} onChange={set("website")} {...inv("website")} />
      </Field>
    </div>
  );
}

// ---------------------------------------------------------------- logo
export function LogoField({ logoUrl, disabled }: { logoUrl: string | null; disabled?: boolean }) {
  const { t } = useI18n();
  const [pending, start] = React.useTransition();
  const inputRef = React.useRef<HTMLInputElement>(null);
  const [preview, setPreview] = React.useState<string | null>(logoUrl);
  React.useEffect(() => setPreview(logoUrl), [logoUrl]);

  const onFile = (file: File | undefined) => {
    if (!file) return;
    const fd = new FormData();
    fd.set("logo", file);
    const local = URL.createObjectURL(file);
    start(async () => {
      const r = await uploadLogo(fd);
      if (r.ok) {
        setPreview(local);
        toast.success(t("common.saved"));
      } else {
        URL.revokeObjectURL(local);
        toast.error(r.error);
      }
      if (inputRef.current) inputRef.current.value = "";
    });
  };

  return (
    <div>
      <Label htmlFor="biz-logo">{t("onb.logo")}</Label>
      <div className="flex items-center gap-4">
        <div className="grid size-20 shrink-0 place-items-center overflow-hidden rounded-2xl border border-dashed bg-muted/50">
          {preview ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={preview} alt={t("onb.logo")} className="size-full object-contain p-1.5" />
          ) : (
            <ImagePlus className="size-6 text-muted-foreground" />
          )}
        </div>
        <div className="grid gap-2">
          <input
            ref={inputRef}
            id="biz-logo"
            type="file"
            accept="image/jpeg,image/png,image/webp"
            className="sr-only"
            disabled={disabled || pending}
            onChange={(e) => onFile(e.target.files?.[0])}
          />
          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="outline" size="sm" disabled={disabled || pending} onClick={() => inputRef.current?.click()}>
              {pending ? <Loader2 className="animate-spin" /> : <ImagePlus />}
              {t("onb.logo")}
            </Button>
            {preview && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                disabled={pending}
                onClick={() =>
                  start(async () => {
                    const r = await removeLogo();
                    if (r.ok) setPreview(null);
                    else toast.error(r.error);
                  })
                }
              >
                <Trash2 /> {t("onb.logoRemove")}
              </Button>
            )}
          </div>
          <p className="text-xs text-muted-foreground">{t("onb.logoHint")}</p>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- bank
export function BankFields({ value, onChange, errors }: { value: BankInput; onChange: (v: BankInput) => void; errors: FieldErrors }) {
  const { t } = useI18n();
  const set = (k: keyof BankInput) => (e: React.ChangeEvent<HTMLInputElement>) => onChange({ ...value, [k]: e.target.value });
  return (
    <div className="grid gap-4">
      <Field id="bank-name" label={t("onb.bankName")} optional error={errors.bankName}>
        <Input id="bank-name" maxLength={80} list="my-banks" placeholder="Maybank" value={value.bankName ?? ""} onChange={set("bankName")} />
        <datalist id="my-banks">
          {["Maybank", "CIMB Bank", "Public Bank", "RHB Bank", "Hong Leong Bank", "AmBank", "Bank Islam", "Bank Rakyat", "BSN", "Affin Bank", "Alliance Bank", "Bank Muamalat", "OCBC", "UOB", "HSBC", "Standard Chartered", "Agrobank", "GXBank", "AEON Bank", "Boost Bank"].map((b) => (
            <option key={b} value={b} />
          ))}
        </datalist>
      </Field>
      <Field id="bank-no" label={t("onb.bankNo")} optional error={errors.bankAccountNo}>
        <Input id="bank-no" inputMode="numeric" maxLength={40} value={value.bankAccountNo ?? ""} onChange={set("bankAccountNo")} aria-invalid={Boolean(errors.bankAccountNo)} />
      </Field>
      <Field id="bank-holder" label={t("onb.bankHolder")} optional error={errors.bankAccountHolder} hint={t("onb.bankHint")}>
        <Input id="bank-holder" maxLength={120} value={value.bankAccountHolder ?? ""} onChange={set("bankAccountHolder")} />
      </Field>
    </div>
  );
}

// ---------------------------------------------------------------- documents
export function DocumentFields({
  value,
  onChange,
  errors,
  showNotes = false,
}: {
  value: DocumentSettingsInput;
  onChange: (v: DocumentSettingsInput) => void;
  errors: FieldErrors;
  showNotes?: boolean;
}) {
  const { t } = useI18n();
  const set = (k: keyof DocumentSettingsInput) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
    onChange({ ...value, [k]: e.target.value });
  const templates = [
    { v: "classic", label: t("onb.tpl.classic"), swatch: "bg-[#202832]" },
    { v: "modern", label: t("onb.tpl.modern"), swatch: "bg-[#B77945]" },
    { v: "navy", label: t("onb.tpl.navy"), swatch: "bg-[#17324D]" },
  ] as const;
  return (
    <div className="grid gap-5">
      <fieldset>
        <legend className="mb-1.5 text-[13px] font-medium text-muted-foreground">{t("onb.template")}</legend>
        <div className="grid grid-cols-3 gap-2">
          {templates.map((tp) => (
            <label
              key={tp.v}
              className={cn(
                "flex min-h-11 cursor-pointer flex-col gap-2 rounded-2xl border p-3 text-sm font-medium transition-colors has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-primary/30",
                value.documentTemplate === tp.v ? "border-primary bg-primary-soft text-primary" : "hover:bg-muted",
              )}
            >
              <input type="radio" name="tpl" value={tp.v} className="sr-only" checked={value.documentTemplate === tp.v} onChange={set("documentTemplate")} />
              <span className={cn("h-2 w-10 rounded-full", tp.swatch)} aria-hidden />
              {tp.label}
            </label>
          ))}
        </div>
      </fieldset>

      <fieldset>
        <legend className="mb-1.5 text-[13px] font-medium text-muted-foreground">{t("onb.prefixes")}</legend>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {(
            [
              ["quotationPrefix", "onb.qtPrefix"],
              ["invoicePrefix", "onb.invPrefix"],
              ["deliveryOrderPrefix", "onb.doPrefix"],
              ["receiptPrefix", "onb.rcPrefix"],
            ] as const
          ).map(([k, label]) => (
            <Field key={k} id={`doc-${k}`} label={t(label)} error={errors[k]}>
              <Input
                id={`doc-${k}`}
                maxLength={8}
                autoCapitalize="characters"
                className="uppercase"
                value={String(value[k] ?? "")}
                onChange={set(k)}
                aria-invalid={Boolean(errors[k])}
              />
            </Field>
          ))}
        </div>
        <p className="mt-1 text-xs text-muted-foreground">{t("onb.prefixHint")}</p>
      </fieldset>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field id="doc-terms" label={t("onb.terms")} error={errors.paymentTermsDays}>
          <Select id="doc-terms" value={String(value.paymentTermsDays)} onChange={set("paymentTermsDays")}>
            {[0, 7, 14, 30, 45, 60, 90].map((d) => (
              <option key={d} value={d}>
                {d}
              </option>
            ))}
          </Select>
        </Field>
        <Field id="doc-validity" label={t("onb.validity")} error={errors.quotationValidityDays}>
          <Select id="doc-validity" value={String(value.quotationValidityDays)} onChange={set("quotationValidityDays")}>
            {[7, 14, 30, 45, 60, 90].map((d) => (
              <option key={d} value={d}>
                {d}
              </option>
            ))}
          </Select>
        </Field>
      </div>

      <div className="grid gap-4 sm:grid-cols-[8rem_1fr]">
        <Field id="doc-tax-label" label="Label" error={errors.taxLabel}>
          <Input id="doc-tax-label" maxLength={20} value={value.taxLabel ?? "SST"} onChange={set("taxLabel")} />
        </Field>
        <Field id="doc-tax" label={t("onb.taxRate")} error={errors.defaultTaxRate} hint={t("onb.taxHint")}>
          <Input id="doc-tax" inputMode="decimal" maxLength={6} value={value.defaultTaxRate} onChange={set("defaultTaxRate")} aria-invalid={Boolean(errors.defaultTaxRate)} />
        </Field>
      </div>

      {showNotes && (
        <>
          <Field id="doc-taxreg" label="No. pendaftaran SST / Tax registration no." optional error={errors.taxRegistrationNo}>
            <Input id="doc-taxreg" maxLength={40} value={value.taxRegistrationNo ?? ""} onChange={set("taxRegistrationNo")} />
          </Field>
          <Field id="doc-notes" label="Nota biasa / Default notes" optional error={errors.defaultNotes}>
            <Textarea id="doc-notes" rows={2} maxLength={1000} value={value.defaultNotes ?? ""} onChange={set("defaultNotes")} />
          </Field>
          <Field id="doc-tnc" label="Terma & syarat biasa / Default terms" optional error={errors.defaultTerms}>
            <Textarea id="doc-tnc" rows={3} maxLength={2000} value={value.defaultTerms ?? ""} onChange={set("defaultTerms")} />
          </Field>
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- settings cards (edit after onboarding)
function SaveBar({ pending, onSave }: { pending: boolean; onSave: () => void }) {
  const { t } = useI18n();
  return (
    <div className="mt-5 flex justify-end">
      <Button type="button" onClick={onSave} disabled={pending}>
        {pending && <Loader2 className="animate-spin" />}
        {t("common.save")}
      </Button>
    </div>
  );
}

export function BusinessSettingsForm({ initial, logoUrl, canEdit }: { initial: BusinessInput; logoUrl: string | null; canEdit: boolean }) {
  const { t } = useI18n();
  const [value, setValue] = React.useState(initial);
  const [errors, setErrors] = React.useState<FieldErrors>({});
  const [pending, start] = React.useTransition();
  return (
    <fieldset disabled={!canEdit} className="grid gap-5">
      <LogoField logoUrl={logoUrl} disabled={!canEdit} />
      <BusinessFields value={value} onChange={setValue} errors={errors} />
      {canEdit && (
        <SaveBar
          pending={pending}
          onSave={() =>
            start(async () => {
              const r = await updateOrganization(value);
              setErrors(r.ok ? {} : (r.fieldErrors ?? {}));
              if (r.ok) toast.success(t("common.saved"));
              else toast.error(r.error);
            })
          }
        />
      )}
    </fieldset>
  );
}

export function BankSettingsForm({ initial, canEdit }: { initial: BankInput; canEdit: boolean }) {
  const { t } = useI18n();
  const [value, setValue] = React.useState(initial);
  const [errors, setErrors] = React.useState<FieldErrors>({});
  const [pending, start] = React.useTransition();
  return (
    <fieldset disabled={!canEdit}>
      <BankFields value={value} onChange={setValue} errors={errors} />
      {canEdit && (
        <SaveBar
          pending={pending}
          onSave={() =>
            start(async () => {
              const r = await updateBank(value);
              setErrors(r.ok ? {} : (r.fieldErrors ?? {}));
              if (r.ok) toast.success(t("common.saved"));
              else toast.error(r.error);
            })
          }
        />
      )}
    </fieldset>
  );
}

export function DocumentSettingsForm({ initial, canEdit }: { initial: DocumentSettingsInput; canEdit: boolean }) {
  const { t } = useI18n();
  const [value, setValue] = React.useState(initial);
  const [errors, setErrors] = React.useState<FieldErrors>({});
  const [pending, start] = React.useTransition();
  return (
    <fieldset disabled={!canEdit}>
      <DocumentFields value={value} onChange={setValue} errors={errors} showNotes />
      {canEdit && (
        <SaveBar
          pending={pending}
          onSave={() =>
            start(async () => {
              const r = await updateDocumentSettings(value);
              setErrors(r.ok ? {} : (r.fieldErrors ?? {}));
              if (r.ok) toast.success(t("common.saved"));
              else toast.error(r.error);
            })
          }
        />
      )}
    </fieldset>
  );
}
