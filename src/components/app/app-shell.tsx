"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Dialog as D } from "radix-ui";
import {
  BarChart3,
  Building2,
  Camera,
  Home,
  LayoutGrid,
  ListOrdered,
  LogOut,
  Menu,
  Mic,
  PenLine,
  Plus,
  Settings,
  Tags,
  X,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useI18n } from "@/components/providers";
import type { MessageKey } from "@/lib/i18n";
import { signOut } from "@/app/actions/auth";
import { AddSheet } from "./add-sheet";
import { Logo } from "./logo";

interface NavItem {
  href: string;
  icon: LucideIcon;
  label: MessageKey;
}
interface NavSection {
  title: MessageKey;
  items: NavItem[];
}

/**
 * Sidebar sections. Only modules that already work are listed; Jualan (sales documents), Pengurusan and
 * Laporan bisnes are added as each phase is delivered — no placeholder links.
 */
const SECTIONS: NavSection[] = [
  {
    title: "nav.section.kirago",
    items: [
      { href: "/", icon: LayoutGrid, label: "nav.expenseSummary" },
      { href: "/add/scan", icon: Camera, label: "add.scan" },
      { href: "/add/voice", icon: Mic, label: "add.voice" },
      { href: "/add/manual", icon: PenLine, label: "add.manual" },
      { href: "/expenses", icon: ListOrdered, label: "nav.expenseList" },
      { href: "/categories", icon: Tags, label: "nav.categories" },
      { href: "/reports", icon: BarChart3, label: "nav.reports" },
    ],
  },
  {
    title: "nav.section.settings",
    items: [{ href: "/settings", icon: Settings, label: "nav.profile" }],
  },
];

const MOBILE = [
  { href: "/", icon: Home, label: "nav.home" },
  { href: "/expenses", icon: ListOrdered, label: "nav.expenses" },
  { href: "#add", icon: Plus, label: "nav.add" },
  { href: "/reports", icon: BarChart3, label: "nav.reports" },
  { href: "#menu", icon: Menu, label: "nav.menu" },
] as const;

function isActive(pathname: string, href: string) {
  return href === "/" ? pathname === "/" : pathname === href || pathname.startsWith(`${href}/`);
}

function NavList({ pathname, onNavigate }: { pathname: string; onNavigate?: () => void }) {
  const { t } = useI18n();
  return (
    <nav className="grid gap-6" aria-label={t("nav.menu")}>
      {SECTIONS.map((s) => (
        <div key={s.title}>
          <div className="px-3 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">{t(s.title)}</div>
          <div className="mt-2 grid gap-0.5">
            {s.items.map((n) => (
              <Link
                key={n.href}
                href={n.href}
                onClick={onNavigate}
                aria-current={isActive(pathname, n.href) ? "page" : undefined}
                className={cn(
                  "flex min-h-11 items-center gap-3 rounded-xl px-3 py-2 text-[15px] font-medium transition-colors",
                  isActive(pathname, n.href) ? "bg-primary-soft text-primary" : "text-muted-foreground hover:bg-muted hover:text-foreground",
                )}
              >
                <n.icon className="size-[18px] shrink-0" />
                {t(n.label)}
              </Link>
            ))}
          </div>
        </div>
      ))}
    </nav>
  );
}

function AccountFooter({ userLabel, businessName }: { userLabel: string; businessName: string }) {
  const { t } = useI18n();
  return (
    <div className="grid gap-2 border-t pt-4">
      <div className="flex items-center gap-3 px-3">
        <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-accent-soft text-accent">
          <Building2 className="size-4" />
        </span>
        <span className="min-w-0">
          <span className="block truncate text-sm font-semibold">{businessName}</span>
          <span className="block truncate text-xs text-muted-foreground">{userLabel}</span>
        </span>
      </div>
      <form action={signOut}>
        <button
          type="submit"
          className="flex min-h-11 w-full items-center gap-3 rounded-xl px-3 py-2 text-sm text-muted-foreground hover:bg-muted hover:text-foreground"
        >
          <LogOut className="size-4" /> {t("nav.signOut")}
        </button>
      </form>
    </div>
  );
}

export function AppShell({ children, userLabel, businessName }: { children: React.ReactNode; userLabel: string; businessName: string }) {
  const pathname = usePathname();
  const { t } = useI18n();
  const [addOpen, setAddOpen] = React.useState(false);
  const [menuOpen, setMenuOpen] = React.useState(false);

  return (
    <div className="min-h-dvh lg:flex">
      {/* Desktop sidebar */}
      <aside className="sticky top-0 hidden h-dvh w-72 shrink-0 flex-col gap-8 overflow-y-auto border-r bg-card/70 px-4 py-6 backdrop-blur lg:flex">
        <Link href="/" className="px-2" aria-label="BukuTigaLima">
          <Logo />
        </Link>
        <NavList pathname={pathname} />
        <div className="mt-auto">
          <AccountFooter userLabel={userLabel} businessName={businessName} />
        </div>
      </aside>

      <div className="min-w-0 flex-1">
        {/* Mobile top bar */}
        <header className="sticky top-0 z-30 flex items-center justify-between border-b bg-background/85 px-4 pb-2 pt-[max(0.5rem,env(safe-area-inset-top))] backdrop-blur-xl lg:hidden">
          <Link href="/" aria-label="BukuTigaLima">
            <Logo />
          </Link>
          <button
            type="button"
            onClick={() => setMenuOpen(true)}
            aria-label={t("nav.menu")}
            className="grid size-11 place-items-center rounded-xl text-foreground hover:bg-muted"
          >
            <Menu className="size-6" />
          </button>
        </header>
        <main className="mx-auto w-full max-w-5xl px-4 pb-32 pt-4 sm:px-6 lg:px-10 lg:pb-12 lg:pt-8">{children}</main>
      </div>

      {/* Mobile bottom navigation */}
      <nav className="fixed inset-x-0 bottom-0 z-40 border-t bg-card/90 pb-safe backdrop-blur-xl lg:hidden" aria-label="Main">
        <div className="mx-auto grid max-w-md grid-cols-5 items-end px-2">
          {MOBILE.map((n) =>
            n.href === "#add" ? (
              <button
                key="add"
                type="button"
                onClick={() => setAddOpen(true)}
                aria-label={t("add.title")}
                className="mx-auto -mt-5 mb-1.5 grid size-14 place-items-center rounded-full bg-accent text-accent-foreground shadow-lg shadow-accent/30 transition-transform active:scale-95"
              >
                <Plus className="size-7" strokeWidth={2.4} />
              </button>
            ) : n.href === "#menu" ? (
              <button
                key="menu"
                type="button"
                onClick={() => setMenuOpen(true)}
                className="flex flex-col items-center gap-0.5 py-2.5 text-[11px] font-medium text-muted-foreground"
              >
                <n.icon className="size-[22px]" strokeWidth={1.9} />
                {t(n.label)}
              </button>
            ) : (
              <Link
                key={n.href}
                href={n.href}
                className={cn(
                  "flex flex-col items-center gap-0.5 py-2.5 text-[11px] font-medium",
                  isActive(pathname, n.href) ? "text-primary" : "text-muted-foreground",
                )}
              >
                <n.icon className="size-[22px]" strokeWidth={isActive(pathname, n.href) ? 2.4 : 1.9} />
                {t(n.label)}
              </Link>
            ),
          )}
        </div>
      </nav>

      {/* Mobile navigation drawer */}
      <D.Root open={menuOpen} onOpenChange={setMenuOpen}>
        <D.Portal>
          <D.Overlay className="fixed inset-0 z-50 bg-black/40 backdrop-blur-[2px] lg:hidden" />
          <D.Content className="fixed inset-y-0 left-0 z-50 flex w-[85vw] max-w-80 flex-col gap-6 overflow-y-auto border-r bg-card px-4 pb-[max(1rem,env(safe-area-inset-bottom))] pt-[max(1rem,env(safe-area-inset-top))] shadow-2xl data-[state=open]:animate-[fade-up_0.2s_ease] lg:hidden">
            <div className="flex items-center justify-between px-2">
              <D.Title asChild>
                <span>
                  <Logo />
                </span>
              </D.Title>
              <D.Description className="sr-only">{t("nav.menu")}</D.Description>
              <D.Close className="grid size-11 place-items-center rounded-xl text-muted-foreground hover:bg-muted" aria-label={t("nav.closeMenu")}>
                <X className="size-5" />
              </D.Close>
            </div>
            <NavList pathname={pathname} onNavigate={() => setMenuOpen(false)} />
            <div className="mt-auto">
              <AccountFooter userLabel={userLabel} businessName={businessName} />
            </div>
          </D.Content>
        </D.Portal>
      </D.Root>
      <AddSheet open={addOpen} onOpenChange={setAddOpen} />
    </div>
  );
}
