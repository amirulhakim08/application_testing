"use client";

import * as React from "react";
import { AlertTriangle, Briefcase, ChevronDown, User } from "lucide-react";
import { cn } from "@/lib/utils";
import { useI18n } from "@/components/providers";
import { Input, Label, Textarea } from "@/components/ui/input";
import { Segmented } from "@/components/ui/segmented";
import { useAppData, useWorkspaceHelpers } from "./app-data";
import { CategoryIcon } from "./category-icon";
import { formatMoney } from "@/lib/money";

export interface ExpenseDraft {
  amount: string;
  workspaceId: string | null;
  categoryId: string | null;
  merchant: string;
  description: string;
  date: string;
  time: string;
  notes: string;
  tax: string;
  discount: string;
}

export type DraftField = keyof ExpenseDraft;

export function AmountInput({
  value,
  onChange,
  uncertain,
  autoFocus,
  id = "amount",
  error,
}: {
  value: string;
  onChange: (v: string) => void;
  uncertain?: boolean;
  autoFocus?: boolean;
  id?: string;
  error?: string;
}) {
  const { t } = useI18n();
  return (
    <div>
      <label htmlFor={id} className="sr-only">
        {t("form.amount")}
      </label>
      <div
        className={cn(
          "flex items-baseline justify-center gap-2 rounded-3xl border bg-card px-4 py-5 transition-colors focus-within:border-primary",
          (uncertain || error) && "border-warning bg-warning-soft/60",
        )}
      >
        <span className="text-xl font-medium text-muted-foreground">RM</span>
        <input
          id={id}
          inputMode="decimal"
          autoComplete="off"
          autoFocus={autoFocus}
          placeholder="0.00"
          value={value}
          aria-invalid={Boolean(uncertain || error)}
          onChange={(e) => onChange(e.target.value.replace(/[^\d.,]/g, ""))}
          className="tabular w-full min-w-0 max-w-[12ch] bg-transparent text-center text-5xl font-semibold tracking-tight outline-none placeholder:text-muted-foreground/40"
        />
      </div>
      {(uncertain || error) && (
        <p className="mt-1.5 flex items-center justify-center gap-1 text-xs font-medium text-warning">
          <AlertTriangle className="size-3.5" /> {error ?? t("common.uncertain")}
        </p>
      )}
    </div>
  );
}

export function WorkspacePicker({ value, onChange, missing }: { value: string | null; onChange: (id: string) => void; missing?: boolean }) {
  const { t } = useI18n();
  const { byKind } = useWorkspaceHelpers();
  const personal = byKind("personal");
  const company = byKind("company");
  return (
    <div>
      <Label>{t("form.workspace")}</Label>
      <Segmented
        name={t("form.workspace")}
        value={value}
        onChange={onChange}
        className={cn(missing && "ring-2 ring-warning")}
        options={[
          { value: personal.id, tone: "personal", label: <><User className="size-4" /> {t("ws.personal")}</> },
          { value: company.id, tone: "company", label: <><Briefcase className="size-4" /> <span className="max-w-[10ch] truncate">{company.name}</span></> },
        ]}
      />
      {missing && <p className="mt-1.5 text-xs font-medium text-warning">{t("voice.pickWorkspace")}</p>}
    </div>
  );
}

export function CategoryPicker({ workspaceId, value, onChange, uncertain }: { workspaceId: string | null; value: string | null; onChange: (id: string) => void; uncertain?: boolean }) {
  const { t } = useI18n();
  const { categoriesFor, kindOf } = useWorkspaceHelpers();
  if (!workspaceId) return null;
  const list = categoriesFor(workspaceId, value);
  const company = kindOf(workspaceId) === "company";
  return (
    <div>
      <Label className={cn(uncertain && "text-warning")}>
        {t("form.category")} {uncertain && <span className="text-[11px]">· {t("common.ai")}</span>}
      </Label>
      <div className="flex flex-wrap gap-2" role="radiogroup" aria-label={t("form.category")}>
        {list.map((c) => {
          const active = c.id === value;
          return (
            <button
              key={c.id}
              type="button"
              role="radio"
              aria-checked={active}
              onClick={() => onChange(c.id)}
              className={cn(
                "flex h-9 items-center gap-1.5 rounded-full border px-3 text-[13px] font-medium transition-all active:scale-95",
                active
                  ? company
                    ? "border-company bg-company text-white dark:text-[#0b110e]"
                    : "border-primary bg-primary text-primary-foreground"
                  : "bg-card text-muted-foreground hover:text-foreground",
              )}
            >
              <CategoryIcon icon={c.icon} className="size-3.5" />
              {c.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

/** All fields of an expense; controlled. Used by manual, edit, receipt review and voice review. */
export function ExpenseFields({
  draft,
  onChange,
  uncertain = new Set(),
  errors = {},
  autoFocusAmount,
  amountOptions,
  showMoreInitially,
  idPrefix = "f",
  extra,
}: {
  draft: ExpenseDraft;
  onChange: (patch: Partial<ExpenseDraft>) => void;
  uncertain?: Set<DraftField>;
  errors?: Partial<Record<string, string>>;
  autoFocusAmount?: boolean;
  amountOptions?: number[];
  showMoreInitially?: boolean;
  idPrefix?: string;
  extra?: React.ReactNode;
}) {
  const { t } = useI18n();
  const { categoryByName, categoriesFor } = useWorkspaceHelpers();
  const data = useAppData();
  const [more, setMore] = React.useState(Boolean(showMoreInitially));
  const id = (k: string) => `${idPrefix}-${k}`;

  const changeWorkspace = (wsId: string) => {
    if (wsId === draft.workspaceId) return;
    // Keep the same category if it exists in the other workspace (e.g. Travel), else "Other".
    const currentName = data.categories.find((c) => c.id === draft.categoryId)?.name ?? null;
    const last = data.lastCategoryByWorkspace[wsId];
    const mapped = currentName ? categoryByName(wsId, currentName) : categoriesFor(wsId).find((c) => c.id === last) ?? categoryByName(wsId, null);
    onChange({ workspaceId: wsId, categoryId: mapped?.id ?? null });
  };

  return (
    <div className="grid gap-5">
      <AmountInput id={id("amount")} value={draft.amount} onChange={(v) => onChange({ amount: v })} uncertain={uncertain.has("amount")} autoFocus={autoFocusAmount} error={errors.amount} />
      {amountOptions && amountOptions.length > 1 && (
        <div className="flex flex-wrap justify-center gap-2">
          {amountOptions.map((c) => (
            <button
              key={c}
              type="button"
              onClick={() => onChange({ amount: (c / 100).toFixed(2) })}
              className={cn(
                "tabular h-9 rounded-full border px-4 text-sm font-medium",
                draft.amount && Math.round(Number(draft.amount) * 100) === c ? "border-primary bg-primary-soft text-primary" : "bg-card",
              )}
            >
              {formatMoney(c)}
            </button>
          ))}
        </div>
      )}
      <WorkspacePicker value={draft.workspaceId} onChange={changeWorkspace} missing={!draft.workspaceId} />
      <CategoryPicker workspaceId={draft.workspaceId} value={draft.categoryId} onChange={(c) => onChange({ categoryId: c })} uncertain={uncertain.has("categoryId")} />
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <Label htmlFor={id("description")}>{t("form.description")}</Label>
          <Input id={id("description")} value={draft.description} maxLength={240} onChange={(e) => onChange({ description: e.target.value })} aria-invalid={uncertain.has("description")} />
        </div>
        <div>
          <Label htmlFor={id("date")} className={cn(uncertain.has("date") && "text-warning")}>
            {t("form.date")}
          </Label>
          <Input id={id("date")} type="date" required value={draft.date} onChange={(e) => onChange({ date: e.target.value })} aria-invalid={uncertain.has("date") || Boolean(errors.expenseDate)} />
        </div>
      </div>

      <button type="button" onClick={() => setMore((m) => !m)} className="flex items-center gap-1 self-start text-sm font-medium text-primary" aria-expanded={more}>
        {t("form.more")} <ChevronDown className={cn("size-4 transition-transform", more && "rotate-180")} />
      </button>
      {more && (
        <div className="grid animate-fade-up gap-4 sm:grid-cols-2">
          <div>
            <Label htmlFor={id("merchant")} className={cn(uncertain.has("merchant") && "text-warning")}>
              {t("form.merchant")}
            </Label>
            <Input id={id("merchant")} value={draft.merchant} maxLength={120} onChange={(e) => onChange({ merchant: e.target.value })} aria-invalid={uncertain.has("merchant")} />
          </div>
          <div>
            <Label htmlFor={id("time")}>
              {t("form.time")} <span className="text-[11px]">({t("form.optional")})</span>
            </Label>
            <Input id={id("time")} type="time" value={draft.time} onChange={(e) => onChange({ time: e.target.value })} />
          </div>
          <div>
            <Label htmlFor={id("tax")}>
              {t("form.tax")} <span className="text-[11px]">({t("form.optional")})</span>
            </Label>
            <Input id={id("tax")} inputMode="decimal" value={draft.tax} onChange={(e) => onChange({ tax: e.target.value.replace(/[^\d.]/g, "") })} />
          </div>
          <div>
            <Label htmlFor={id("discount")}>
              {t("form.discount")} <span className="text-[11px]">({t("form.optional")})</span>
            </Label>
            <Input id={id("discount")} inputMode="decimal" value={draft.discount} onChange={(e) => onChange({ discount: e.target.value.replace(/[^\d.]/g, "") })} />
          </div>
          <div className="sm:col-span-2">
            <Label htmlFor={id("notes")}>
              {t("form.notes")} <span className="text-[11px]">({t("form.optional")})</span>
            </Label>
            <Textarea id={id("notes")} value={draft.notes} maxLength={1000} onChange={(e) => onChange({ notes: e.target.value })} />
          </div>
          {extra && <div className="sm:col-span-2">{extra}</div>}
        </div>
      )}
    </div>
  );
}

export function draftToInput(
  d: ExpenseDraft,
  extra: { entryMethod: "receipt_scan" | "voice" | "manual"; receiptFileId?: string | null; aiExtractionId?: string | null; items?: Array<{ name: string; quantity: number | null; amount: string | null }>; confirmDuplicate?: boolean },
) {
  return {
    amount: d.amount.replace(/,/g, ""),
    currency: "MYR",
    workspaceId: d.workspaceId ?? "",
    categoryId: d.categoryId,
    merchant: d.merchant,
    description: d.description,
    notes: d.notes,
    expenseDate: d.date,
    expenseTime: d.time,
    taxAmount: d.tax || undefined,
    discountAmount: d.discount || undefined,
    entryMethod: extra.entryMethod,
    receiptFileId: extra.receiptFileId ?? null,
    aiExtractionId: extra.aiExtractionId ?? null,
    items: extra.items,
    confirmDuplicate: extra.confirmDuplicate,
  };
}
