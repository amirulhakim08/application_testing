"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { BarChart3, Home, LayoutGrid, ListOrdered, Plus, Settings, Tags } from "lucide-react";
import { cn } from "@/lib/utils";
import { useI18n } from "@/components/providers";
import { AddSheet, CAPTURE_OPTIONS } from "./add-sheet";
import { Logo } from "./logo";

const MOBILE = [
  { href: "/", icon: Home, label: "nav.home" },
  { href: "/expenses", icon: ListOrdered, label: "nav.expenses" },
  { href: "#add", icon: Plus, label: "nav.add" },
  { href: "/reports", icon: BarChart3, label: "nav.reports" },
  { href: "/settings", icon: Settings, label: "nav.settings" },
] as const;

const DESKTOP = [
  { href: "/", icon: LayoutGrid, label: "nav.dashboard" },
  { href: "/expenses", icon: ListOrdered, label: "nav.expenses" },
  { href: "/reports", icon: BarChart3, label: "nav.analytics" },
  { href: "/categories", icon: Tags, label: "nav.categories" },
  { href: "/settings", icon: Settings, label: "nav.settings" },
] as const;

function isActive(pathname: string, href: string) {
  return href === "/" ? pathname === "/" : pathname.startsWith(href);
}

export function AppShell({ children, userLabel }: { children: React.ReactNode; userLabel: string }) {
  const pathname = usePathname();
  const { t } = useI18n();
  const [addOpen, setAddOpen] = React.useState(false);

  return (
    <div className="min-h-dvh lg:flex">
      {/* Desktop sidebar */}
      <aside className="sticky top-0 hidden h-dvh w-64 shrink-0 flex-col border-r bg-card/60 px-4 py-6 backdrop-blur lg:flex">
        <Link href="/" className="px-2">
          <Logo />
        </Link>
        <nav className="mt-8 grid gap-1">
          {DESKTOP.map((n) => (
            <Link
              key={n.href}
              href={n.href}
              className={cn(
                "flex items-center gap-3 rounded-xl px-3 py-2.5 text-[15px] font-medium transition-colors",
                isActive(pathname, n.href) ? "bg-primary-soft text-primary" : "text-muted-foreground hover:bg-muted hover:text-foreground",
              )}
            >
              <n.icon className="size-[18px]" />
              {t(n.label)}
            </Link>
          ))}
        </nav>
        <div className="mt-8 px-3 text-xs font-medium uppercase tracking-wider text-muted-foreground">{t("add.quick")}</div>
        <div className="mt-2 grid gap-1">
          {CAPTURE_OPTIONS.map((o) => (
            <Link key={o.href} href={o.href} className="flex items-center gap-3 rounded-xl px-3 py-2 text-sm text-muted-foreground hover:bg-muted hover:text-foreground">
              <o.icon className="size-4" />
              {t(o.title)}
            </Link>
          ))}
        </div>
        <div className="mt-auto truncate px-3 text-xs text-muted-foreground">{userLabel}</div>
      </aside>

      <div className="min-w-0 flex-1">
        <main className="mx-auto w-full max-w-5xl px-4 pb-32 pt-[max(1rem,env(safe-area-inset-top))] sm:px-6 lg:px-10 lg:pb-12 lg:pt-8">{children}</main>
      </div>

      {/* Mobile bottom navigation */}
      <nav className="fixed inset-x-0 bottom-0 z-40 border-t bg-card/85 pb-safe backdrop-blur-xl lg:hidden" aria-label="Main">
        <div className="mx-auto grid max-w-md grid-cols-5 items-end px-2">
          {MOBILE.map((n) =>
            n.href === "#add" ? (
              <button
                key="add"
                type="button"
                onClick={() => setAddOpen(true)}
                aria-label={t("add.title")}
                className="mx-auto -mt-5 mb-1.5 grid size-14 place-items-center rounded-full bg-primary text-primary-foreground shadow-lg shadow-primary/30 transition-transform active:scale-95"
              >
                <Plus className="size-7" strokeWidth={2.4} />
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
      <AddSheet open={addOpen} onOpenChange={setAddOpen} />
    </div>
  );
}
