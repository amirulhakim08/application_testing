import Link from "next/link";
import { AlertTriangle, ArrowRight, Camera, FilePlus2, FileText, Plus, ReceiptText, ScrollText, Wallet, PieChart, type LucideIcon } from "lucide-react";
import { getContext, getLedger } from "@/lib/data";
import { getI18n } from "@/lib/i18n/server";
import { endOfMonth, formatDateLabel, startOfMonth, todayKL } from "@/lib/dates";
import { formatMoney } from "@/lib/money";
import { listInvoices, listPayments, listQuotations } from "@/lib/sales";
import { cn } from "@/lib/utils";

export const metadata = { title: "Utama" };

/** Home: shortcuts to the main areas, each with a live figure from saved records. */
export default async function Home() {
  const ctx = await getContext();
  const { t, lang } = await getI18n();
  const today = todayKL();
  const monthFrom = startOfMonth(today);
  const monthTo = endOfMonth(today);

  const [quotations, outstanding, payments, ledger] = await Promise.all([
    listQuotations(ctx, { limit: 500 }),
    listInvoices(ctx, { outstandingOnly: true, limit: 1000 }),
    listPayments(ctx, { from: monthFrom, to: monthTo, limit: 1000 }),
    getLedger(ctx, monthFrom, monthTo),
  ]);

  const openQuotes = quotations.filter((q) => q.displayStatus === "draft" || q.displayStatus === "sent").length;
  const unpaid = outstanding.reduce((a, i) => a + i.outstanding, 0);
  const overdue = outstanding.filter((i) => i.daysOverdue > 0);
  const overdueAmt = overdue.reduce((a, i) => a + i.outstanding, 0);
  const validPayments = payments.filter((p) => !p.voided);
  const received = validPayments.reduce((a, p) => a + p.amount, 0);
  const personal = ledger.filter((r) => r.workspaceKind === "personal").reduce((a, r) => a + r.amountCents, 0);
  const business = ledger.filter((r) => r.workspaceKind === "company").reduce((a, r) => a + r.amountCents, 0);
  const firstName = ctx.user.fullName?.split(" ")[0];

  const tiles: Array<{
    href: string;
    icon: LucideIcon;
    title: string;
    stat: string;
    sub?: string;
    tone: string;
    action: { href: string; label: string; icon: LucideIcon };
  }> = [
    {
      href: "/quotations",
      icon: FileText,
      title: t("nav.quotations"),
      stat: t("home.quotations.stat", { n: openQuotes }),
      tone: "bg-primary-soft text-primary",
      action: { href: "/quotations/new", label: t("qt.new"), icon: Plus },
    },
    {
      href: "/invoices",
      icon: ReceiptText,
      title: t("nav.invoices"),
      stat: t("home.invoices.stat", { amt: formatMoney(unpaid) }),
      tone: "bg-accent-soft text-accent",
      action: { href: "/invoices/new", label: t("inv.new"), icon: Plus },
    },
    {
      href: "/receipts",
      icon: ScrollText,
      title: t("nav.receipts"),
      stat: t("home.receipts.stat", { n: validPayments.filter((p) => p.receiptNumber).length, amt: formatMoney(received) }),
      tone: "bg-success-soft text-success",
      action: { href: "/payments", label: t("pay.record"), icon: Wallet },
    },
    {
      href: "/expenses/summary",
      icon: PieChart,
      title: t("home.expenses"),
      stat: t("home.expenses.stat", { amt: formatMoney(personal + business) }),
      sub: t("home.expenses.split", { p: formatMoney(personal), b: formatMoney(business) }),
      tone: "bg-muted text-foreground",
      action: { href: "/add/manual", label: t("add.manual"), icon: Plus },
    },
  ];

  return (
    <div className="animate-fade-up space-y-6">
      <header>
        <p className="text-sm text-muted-foreground">{formatDateLabel(today, lang, { weekday: "long", day: "numeric", month: "long", year: undefined })}</p>
        <h1 className="text-[28px] font-semibold tracking-tight">{t("dash.greeting", { name: firstName ? `, ${firstName}` : "" })}</h1>
        <p className="text-sm text-muted-foreground">{ctx.organization.name}</p>
      </header>

      {overdue.length > 0 && (
        <Link href="/outstanding" className="flex items-center gap-3 rounded-2xl border border-destructive/20 bg-destructive/5 px-4 py-3 text-sm hover:bg-destructive/10">
          <AlertTriangle className="size-5 shrink-0 text-destructive" />
          <span className="flex-1 font-medium">{t("home.overdue", { n: overdue.length, amt: formatMoney(overdueAmt) })}</span>
          <span className="hidden text-destructive sm:inline">{t("home.overdueCta")}</span>
          <ArrowRight className="size-4 text-destructive" />
        </Link>
      )}

      <div className="grid gap-3 sm:grid-cols-2">
        {tiles.map((tile) => (
          <section key={tile.href} aria-label={tile.title} className="flex flex-col rounded-3xl border bg-card shadow-[0_1px_2px_rgba(0,0,0,0.04)] transition-colors hover:border-primary/30">
            <Link href={tile.href} className="flex flex-1 items-start gap-4 rounded-t-3xl p-5">
              <span className={cn("grid size-12 shrink-0 place-items-center rounded-2xl", tile.tone)}>
                <tile.icon className="size-6" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-lg font-semibold tracking-tight">{tile.title}</span>
                <span className="tabular mt-0.5 block text-[15px] text-foreground">{tile.stat}</span>
                {tile.sub && <span className="tabular block text-xs text-muted-foreground">{tile.sub}</span>}
              </span>
              <ArrowRight className="mt-1 size-5 shrink-0 text-muted-foreground" aria-hidden />
            </Link>
            <div className="border-t px-3 py-2">
              <Link href={tile.action.href} className="inline-flex min-h-11 items-center gap-2 rounded-xl px-2 text-sm font-medium text-primary hover:bg-muted">
                <tile.action.icon className="size-4" /> {tile.action.label}
              </Link>
            </div>
          </section>
        ))}
      </div>

      <section>
        <h2 className="mb-2 px-1 text-xs font-medium uppercase tracking-wider text-muted-foreground">{t("home.quick")}</h2>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {[
            { href: "/quotations/new", icon: FilePlus2, label: t("qt.new") },
            { href: "/invoices/new", icon: ReceiptText, label: t("inv.new") },
            { href: "/outstanding", icon: Wallet, label: t("nav.outstanding") },
            { href: "/add/scan", icon: Camera, label: t("add.scan") },
          ].map((a) => (
            <Link
              key={a.href}
              href={a.href}
              className="flex min-h-14 items-center gap-2.5 rounded-2xl border bg-card px-3.5 py-3 text-sm font-medium shadow-sm transition-all hover:border-primary/40 active:scale-[0.98]"
            >
              <a.icon className="size-[18px] shrink-0 text-primary" />
              {a.label}
            </Link>
          ))}
        </div>
      </section>
    </div>
  );
}
