"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTheme } from "next-themes";
import { toast } from "sonner";
import { ChevronRight, Download, FileJson, Loader2, LogOut, Tags, Trash2 } from "lucide-react";
import { useI18n } from "@/components/providers";
import { Button } from "@/components/ui/button";
import { Input, Label, Select } from "@/components/ui/input";
import { Segmented } from "@/components/ui/segmented";
import { Card } from "@/components/ui/card";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { deleteAccount, deleteAllReceiptImages, updatePreferences, updateProfile } from "@/app/actions/settings";
import { signOut } from "@/app/actions/auth";

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h2 className="mb-2 px-1 text-xs font-medium uppercase tracking-wider text-muted-foreground">{title}</h2>
      <Card className="grid gap-4 p-5">{children}</Card>
    </section>
  );
}

export function SettingsForms({
  profile,
  prefs,
  usage,
}: {
  profile: { fullName: string; email: string; companyName: string };
  prefs: { language: "en" | "ms"; theme: "system" | "light" | "dark"; receiptRetention: "keep" | "days_90" | "none"; currency: string };
  usage: { scans: number; transcriptions: number; errors: number };
}) {
  const { t } = useI18n();
  const router = useRouter();
  const { setTheme } = useTheme();
  const [name, setName] = React.useState(profile.fullName);
  const [company, setCompany] = React.useState(profile.companyName);
  const [saving, setSaving] = React.useState(false);
  const [theme, setThemeState] = React.useState(prefs.theme);
  const [confirm, setConfirm] = React.useState<"receipts" | "account" | null>(null);
  const [typed, setTyped] = React.useState("");

  const pref = async (p: Parameters<typeof updatePreferences>[0]) => {
    const res = await updatePreferences(p);
    if (res.ok) {
      toast.success(t("set.saved"));
      router.refresh();
    } else toast.error(res.error);
  };

  return (
    <div className="grid gap-6">
      <Section title={t("set.profile")}>
        <form
          className="grid gap-4"
          onSubmit={async (e) => {
            e.preventDefault();
            setSaving(true);
            const res = await updateProfile(name, company);
            setSaving(false);
            if (res.ok) {
              toast.success(t("set.saved"));
              router.refresh();
            } else toast.error(res.error);
          }}
        >
          <div>
            <Label htmlFor="s-email">{t("set.email")}</Label>
            <Input id="s-email" value={profile.email} disabled />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <Label htmlFor="s-name">{t("set.fullName")}</Label>
              <Input id="s-name" value={name} maxLength={120} onChange={(e) => setName(e.target.value)} />
            </div>
            <div>
              <Label htmlFor="s-company">{t("set.company")}</Label>
              <Input id="s-company" value={company} maxLength={80} required onChange={(e) => setCompany(e.target.value)} />
            </div>
          </div>
          <Button type="submit" className="justify-self-start" disabled={saving}>
            {saving && <Loader2 className="animate-spin" />} {t("form.update")}
          </Button>
        </form>
      </Section>

      <Section title={t("set.preferences")}>
        <div>
          <Label>{t("set.language")}</Label>
          <Segmented
            value={prefs.language}
            onChange={(v) => pref({ language: v })}
            options={[
              { value: "en", label: "English" },
              { value: "ms", label: "Bahasa Melayu" },
            ]}
          />
        </div>
        <div>
          <Label>{t("set.theme")}</Label>
          <Segmented
            value={theme}
            onChange={(v) => {
              setThemeState(v);
              setTheme(v);
              void pref({ theme: v });
            }}
            options={[
              { value: "system", label: t("set.theme.system") },
              { value: "light", label: t("set.theme.light") },
              { value: "dark", label: t("set.theme.dark") },
            ]}
          />
        </div>
        <div>
          <Label htmlFor="s-cur">{t("set.currency")}</Label>
          <Select id="s-cur" value={prefs.currency} disabled>
            <option value="MYR">MYR — Malaysian Ringgit</option>
          </Select>
          <p className="mt-1.5 text-xs text-muted-foreground">{t("set.currencyHint")}</p>
        </div>
        <Link href="/categories" className="-mx-1 flex items-center gap-3 rounded-xl px-1 py-2 text-[15px] font-medium hover:bg-muted">
          <Tags className="size-5 text-muted-foreground" />
          <span className="flex-1">{t("nav.categories")}</span>
          <ChevronRight className="size-4 text-muted-foreground" />
        </Link>
      </Section>

      <Section title={t("set.receipts")}>
        <div>
          <Label htmlFor="s-ret">{t("set.retention")}</Label>
          <Select id="s-ret" defaultValue={prefs.receiptRetention} onChange={(e) => pref({ receiptRetention: e.target.value as "keep" })}>
            <option value="keep">{t("set.retention.keep")}</option>
            <option value="days_90">{t("set.retention.days_90")}</option>
            <option value="none">{t("set.retention.none")}</option>
          </Select>
        </div>
        <Button variant="outline" className="justify-self-start" onClick={() => setConfirm("receipts")}>
          <Trash2 /> {t("set.deleteReceipts")}
        </Button>
      </Section>

      <Section title={t("set.usage")}>
        <dl className="grid grid-cols-3 gap-3 text-center">
          {[
            [t("set.usage.scans"), usage.scans],
            [t("set.usage.transcriptions"), usage.transcriptions],
            [t("set.usage.errors"), usage.errors],
          ].map(([k, v]) => (
            <div key={k as string} className="rounded-2xl bg-muted p-3">
              <dt className="text-xs text-muted-foreground">{k}</dt>
              <dd className="tabular mt-1 text-xl font-semibold">{v}</dd>
            </div>
          ))}
        </dl>
      </Section>

      <Section title={t("set.data")}>
        <div className="grid gap-2 sm:grid-cols-2">
          <Button variant="outline" asChild>
            <a href="/api/expenses/export" download>
              <Download /> {t("set.exportCsv")}
            </a>
          </Button>
          <Button variant="outline" asChild>
            <a href="/api/account/export" download>
              <FileJson /> {t("set.exportJson")}
            </a>
          </Button>
        </div>
        <Button variant="ghost" className="justify-self-start text-destructive" onClick={() => setConfirm("account")}>
          <Trash2 /> {t("set.deleteAccount")}
        </Button>
      </Section>

      <form action={signOut}>
        <Button variant="outline" size="lg" className="w-full">
          <LogOut /> {t("set.logout")}
        </Button>
      </form>

      <Dialog open={confirm !== null} onOpenChange={(o) => !o && (setConfirm(null), setTyped(""))}>
        <DialogContent
          title={confirm === "account" ? t("set.deleteAccount") : t("set.deleteReceipts")}
          description={confirm === "account" ? t("set.deleteAccountConfirm") : t("set.deleteReceiptsConfirm")}
        >
          {confirm === "account" && <Input value={typed} onChange={(e) => setTyped(e.target.value)} placeholder="DELETE" className="mb-4" aria-label="Type DELETE" />}
          <div className="grid grid-cols-2 gap-2">
            <Button variant="outline" onClick={() => setConfirm(null)}>
              {t("form.cancel")}
            </Button>
            <Button
              variant="destructive"
              disabled={saving || (confirm === "account" && typed !== "DELETE")}
              onClick={async () => {
                setSaving(true);
                const res = confirm === "account" ? await deleteAccount(typed) : await deleteAllReceiptImages();
                setSaving(false);
                setConfirm(null);
                if (res?.ok === false) toast.error(res.error);
                else toast.success(t("set.saved"));
              }}
            >
              {t("form.delete")}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
