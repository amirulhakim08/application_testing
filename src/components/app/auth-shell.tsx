import { BookOpenCheck, FileText, Wallet } from "lucide-react";
import { getI18n } from "@/lib/i18n/server";
import { Logo } from "./logo";
import { LanguageToggle } from "./auth-forms";

export async function AuthShell({ title, subtitle, tagline, children }: { title: string; subtitle?: string; tagline: string; children: React.ReactNode }) {
  const { t } = await getI18n();
  const features = [
    [FileText, t("auth.f1")],
    [BookOpenCheck, t("auth.f2")],
    [Wallet, t("auth.f3")],
  ] as const;
  return (
    <div className="grid min-h-dvh lg:grid-cols-2">
      <div className="relative hidden overflow-hidden bg-[linear-gradient(150deg,#1d3d5d,#0f2236)] p-12 text-[#FAF8F4] lg:flex lg:flex-col">
        <div className="absolute -right-24 -top-24 size-96 rounded-full bg-white/10 blur-3xl" />
        <div className="absolute -bottom-32 left-10 size-80 rounded-full bg-[#B77945]/25 blur-3xl" />
        <div className="relative [&_span]:!text-[#FAF8F4]">
          <Logo />
        </div>
        <div className="relative mt-auto max-w-md">
          <p className="text-sm font-medium uppercase tracking-[0.2em] text-[#E3B88F]">BukuTigaLima</p>
          <p className="mt-3 text-4xl font-semibold leading-tight tracking-tight">{tagline}</p>
          <div className="mt-8 grid gap-3 text-white/80">
            {features.map(([Icon, text], i) => (
              <div key={i} className="flex items-center gap-3">
                <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-white/10">
                  <Icon className="size-4" />
                </span>
                <span className="text-sm">{text}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
      <div className="flex flex-col px-5 py-[max(1.5rem,env(safe-area-inset-top))] sm:px-10">
        <div className="flex items-center justify-between">
          <span className="lg:invisible">
            <Logo />
          </span>
          <LanguageToggle />
        </div>
        <div className="mx-auto my-auto w-full max-w-sm animate-fade-up py-10">
          <h1 className="text-[28px] font-semibold tracking-tight">{title}</h1>
          {subtitle && <p className="mt-1 text-sm text-muted-foreground">{subtitle}</p>}
          <div className="mt-8">{children}</div>
        </div>
      </div>
    </div>
  );
}
