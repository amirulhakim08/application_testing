"use client";

import * as React from "react";
import { Search, UserPlus, X } from "lucide-react";
import { useI18n } from "@/components/providers";
import { Input, Textarea } from "@/components/ui/input";
import { Field } from "@/components/app/business-forms";
import { cn } from "@/lib/utils";

export interface PickerCustomer {
  id: string;
  name: string;
  companyName: string | null;
  phone: string | null;
}
export interface NewCustomer {
  name: string;
  phone: string;
  billingAddress: string;
}

const norm = (s: string) => s.toLowerCase().replace(/[\s\-+()]/g, "");

/**
 * Search-as-you-type customer field. Pick a listed customer, add a new one inline (name, phone, address), or — on
 * direct sale receipts — leave it as a walk-in customer.
 */
export function CustomerPicker({
  customers,
  customerId,
  onSelect,
  newCustomer,
  onNewCustomer,
  saveCustomer,
  onSaveCustomer,
  walkIn,
  required,
  error,
}: {
  customers: PickerCustomer[];
  customerId: string;
  onSelect: (id: string) => void;
  newCustomer: NewCustomer | null;
  onNewCustomer: (c: NewCustomer | null) => void;
  saveCustomer: boolean;
  onSaveCustomer: (v: boolean) => void;
  /** Direct sale receipts: allow "walk-in customer (no name)". */
  walkIn?: boolean;
  required?: boolean;
  error?: string;
}) {
  const { t } = useI18n();
  const [query, setQuery] = React.useState("");
  const [open, setOpen] = React.useState(false);
  const [active, setActive] = React.useState(0);
  const listId = React.useId();
  const boxRef = React.useRef<HTMLDivElement>(null);
  const selected = customers.find((c) => c.id === customerId) ?? null;

  const matches = React.useMemo(() => {
    const q = query.trim().toLowerCase();
    const qn = norm(query);
    const list = q
      ? customers.filter((c) => c.name.toLowerCase().includes(q) || (c.companyName ?? "").toLowerCase().includes(q) || (qn.length >= 3 && norm(c.phone ?? "").includes(qn)))
      : customers;
    return list.slice(0, 8);
  }, [customers, query]);
  // Options = matches + "add new" as the last row
  const count = matches.length + 1;

  React.useEffect(() => {
    if (!open) return;
    const close = (e: PointerEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", close);
    return () => document.removeEventListener("pointerdown", close);
  }, [open]);

  const pick = (i: number) => {
    if (i < matches.length) {
      onSelect(matches[i].id);
      onNewCustomer(null);
    } else {
      const typed = query.trim();
      const looksLikePhone = /^[+\d][\d\s\-()]{5,}$/.test(typed);
      onSelect("");
      onNewCustomer({ name: looksLikePhone ? "" : typed, phone: looksLikePhone ? typed : "", billingAddress: "" });
    }
    setQuery("");
    setOpen(false);
  };

  // A listed customer is chosen
  if (selected) {
    return (
      <div className="grid gap-1.5">
        <span className="text-sm font-medium">{t("c.customer")}</span>
        <div className="flex items-center gap-3 rounded-2xl border bg-muted/40 px-4 py-3">
          <span className="min-w-0 flex-1">
            <span className="block font-semibold">{selected.name}</span>
            <span className="block truncate text-sm text-muted-foreground">{[selected.companyName, selected.phone].filter(Boolean).join(" · ") || "—"}</span>
          </span>
          <button
            type="button"
            className="grid size-9 place-items-center rounded-full text-muted-foreground hover:bg-muted"
            aria-label={t("cus.change")}
            onClick={() => onSelect("")}
          >
            <X className="size-4" />
          </button>
        </div>
      </div>
    );
  }

  // A new customer is being typed
  if (newCustomer) {
    const set = (patch: Partial<NewCustomer>) => onNewCustomer({ ...newCustomer, ...patch });
    return (
      <div className="grid gap-3 rounded-2xl border bg-muted/30 p-4">
        <div className="flex items-center justify-between gap-2">
          <h3 className="font-semibold">{t("cus.newInline")}</h3>
          <button
            type="button"
            className="grid size-9 place-items-center rounded-full text-muted-foreground hover:bg-muted"
            aria-label={t("c.cancel")}
            onClick={() => onNewCustomer(null)}
          >
            <X className="size-4" />
          </button>
        </div>
        <Field id="cm-name" label={t("cus.name")} error={error}>
          <Input id="cm-name" required autoFocus={!newCustomer.name} maxLength={160} value={newCustomer.name} onChange={(e) => set({ name: e.target.value })} />
        </Field>
        <Field id="cm-phone" label={t("cus.phone")} optional>
          <Input id="cm-phone" type="tel" inputMode="tel" maxLength={40} placeholder="012-345 6789" value={newCustomer.phone} onChange={(e) => set({ phone: e.target.value })} />
        </Field>
        <Field id="cm-address" label={t("cus.address")} optional>
          <Textarea id="cm-address" rows={2} maxLength={500} value={newCustomer.billingAddress} onChange={(e) => set({ billingAddress: e.target.value })} />
        </Field>
        <label className="flex items-start gap-3 text-sm">
          <input type="checkbox" className="mt-0.5 size-5 accent-[var(--primary)]" checked={saveCustomer} onChange={(e) => onSaveCustomer(e.target.checked)} />
          <span className="text-muted-foreground">{saveCustomer ? t("cus.willSave") : t("cus.oneOff")}</span>
        </label>
      </div>
    );
  }

  return (
    <div className="grid gap-1.5" ref={boxRef}>
      <label htmlFor="doc-customer" className="text-sm font-medium">
        {t("c.customer")} {required && <span className="text-destructive">*</span>}
      </label>
      <div className="relative">
        <Search className="pointer-events-none absolute left-4 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
        <Input
          id="doc-customer"
          role="combobox"
          aria-expanded={open}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={open ? `${listId}-${active}` : undefined}
          aria-invalid={Boolean(error)}
          autoComplete="off"
          className="pl-11"
          placeholder={t("cus.search")}
          value={query}
          onFocus={() => setOpen(true)}
          onChange={(e) => {
            setQuery(e.target.value);
            setActive(0);
            setOpen(true);
          }}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") {
              e.preventDefault();
              setOpen(true);
              setActive((a) => (a + 1) % count);
            } else if (e.key === "ArrowUp") {
              e.preventDefault();
              setActive((a) => (a - 1 + count) % count);
            } else if (e.key === "Enter" && open) {
              e.preventDefault();
              pick(active);
            } else if (e.key === "Escape") {
              setOpen(false);
            }
          }}
        />
        {open && (
          <ul id={listId} role="listbox" className="absolute inset-x-0 top-full z-30 mt-2 max-h-80 overflow-y-auto rounded-2xl border bg-card p-1.5 shadow-xl">
            {matches.length === 0 && <li className="px-3 py-2.5 text-sm text-muted-foreground">{t("cus.noMatch")}</li>}
            {matches.map((c, i) => (
              <li
                key={c.id}
                id={`${listId}-${i}`}
                role="option"
                aria-selected={active === i}
                onPointerDown={(e) => e.preventDefault()}
                onClick={() => pick(i)}
                onMouseEnter={() => setActive(i)}
                className={cn("flex min-h-12 cursor-pointer items-center justify-between gap-3 rounded-xl px-3 py-2", active === i && "bg-muted")}
              >
                <span className="min-w-0">
                  <span className="block truncate font-medium">{c.name}</span>
                  {c.companyName && <span className="block truncate text-xs text-muted-foreground">{c.companyName}</span>}
                </span>
                {c.phone && <span className="tabular shrink-0 text-sm text-muted-foreground">{c.phone}</span>}
              </li>
            ))}
            <li
              id={`${listId}-${matches.length}`}
              role="option"
              aria-selected={active === matches.length}
              onPointerDown={(e) => e.preventDefault()}
              onClick={() => pick(matches.length)}
              onMouseEnter={() => setActive(matches.length)}
              className={cn("flex min-h-12 cursor-pointer items-center gap-2 rounded-xl px-3 py-2 font-medium text-primary", active === matches.length && "bg-muted")}
            >
              <UserPlus className="size-4 shrink-0" aria-hidden />
              {query.trim() ? t("cus.addNamed", { name: query.trim() }) : t("cus.addNew")}
            </li>
          </ul>
        )}
      </div>
      {error && <p className="text-sm text-destructive">{error}</p>}
      {walkIn && <p className="px-1 text-sm font-medium text-primary">{t("sale.walkIn")}</p>}
    </div>
  );
}
