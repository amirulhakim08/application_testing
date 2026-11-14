import { Camera, Mic, PenLine } from "lucide-react";
import { Logo } from "./logo";
import { LanguageToggle } from "./auth-forms";

export function AuthShell({ title, subtitle, tagline, children }: { title: string; subtitle?: string; tagline: string; children: React.ReactNode }) {
  return (
    <div className="grid min-h-dvh lg:grid-cols-2">
      <div className="relative hidden overflow-hidden bg-[linear-gradient(150deg,#1b5a40,#0d3123)] p-12 text-white lg:flex lg:flex-col">
        <div className="absolute -right-24 -top-24 size-96 rounded-full bg-white/10 blur-3xl" />
        <div className="absolute -bottom-32 left-10 size-80 rounded-full bg-[#c9a96e]/20 blur-3xl" />
        <div className="relative text-white [&_span]:!text-white">
          <Logo />
        </div>
        <div className="relative mt-auto max-w-md">
          <p className="text-4xl font-semibold leading-tight tracking-tight">{tagline}</p>
          <div className="mt-8 grid gap-3 text-white/80">
            {[
              [Camera, "Receipt AI finds the real total — not the subtotal or change."],
              [Mic, "“Semalam beli barang dapur RM85 dekat Lotus.” Done."],
              [PenLine, "Personal and Company, always kept apart."],
            ].map(([Icon, text], i) => {
              const I = Icon as typeof Camera;
              return (
                <div key={i} className="flex items-center gap-3">
                  <span className="grid size-9 place-items-center rounded-xl bg-white/10">
                    <I className="size-4" />
                  </span>
                  <span className="text-sm">{text as string}</span>
                </div>
              );
            })}
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
