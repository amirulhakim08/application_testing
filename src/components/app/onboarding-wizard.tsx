"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Check, Loader2, PartyPopper, PenLine, Camera, Mic } from "lucide-react";
import { toast } from "sonner";
import { useI18n } from "@/components/providers";
import { Button, buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  completeOnboarding,
  createOrganization,
  updateBank,
  updateDocumentSettings,
  type BankInput,
  type BusinessInput,
  type DocumentSettingsInput,
} from "@/app/actions/organization";
import { BankFields, BusinessFields, DocumentFields, LogoField } from "./business-forms";
import type { MessageKey } from "@/lib/i18n";

const STEPS: MessageKey[] = ["onb.s1", "onb.s2", "onb.s3", "onb.s4"];

export function OnboardingWizard({
  hasOrganization,
  initialStep,
  business,
  bank,
  documents,
  logoUrl,
}: {
  hasOrganization: boolean;
  initialStep: number;
  business: BusinessInput;
  bank: BankInput;
  documents: DocumentSettingsInput;
  logoUrl: string | null;
}) {
  const { t } = useI18n();
  const router = useRouter();
  const [step, setStep] = React.useState(initialStep);
  const [orgCreated, setOrgCreated] = React.useState(hasOrganization);
  const [biz, setBiz] = React.useState(business);
  const [bankV, setBank] = React.useState(bank);
  const [docs, setDocs] = React.useState(documents);
  const [errors, setErrors] = React.useState<Record<string, string>>({});
  const [pending, start] = React.useTransition();
  const headingRef = React.useRef<HTMLHeadingElement>(null);

  React.useEffect(() => {
    headingRef.current?.focus();
  }, [step]);

  const run = (fn: () => Promise<{ ok: boolean; error?: string; fieldErrors?: Record<string, string> }>, next: number) =>
    start(async () => {
      const r = await fn();
      if (!r.ok) {
        setErrors(r.fieldErrors ?? {});
        toast.error(r.error ?? "Error");
        return;
      }
      setErrors({});
      setStep(next);
      router.refresh();
    });

  const finish = () =>
    start(async () => {
      const r = await completeOnboarding();
      if (!r.ok) {
        toast.error(r.error);
        return;
      }
      // No router.refresh() here: the onboarding page redirects completed businesses to "/",
      // which would skip the "ready" screen.
      setStep(3);
    });

  return (
    <div className="mx-auto w-full max-w-xl">
      <ol className="mb-8 grid grid-cols-4 gap-2" aria-label={t("onb.title")}>
        {STEPS.map((s, i) => (
          <li key={s} className="grid gap-2">
            <span className={cn("h-1.5 rounded-full", i <= step ? "bg-accent" : "bg-border")} aria-hidden />
            <span className={cn("hidden text-xs sm:block", i === step ? "font-semibold text-foreground" : "text-muted-foreground")} aria-current={i === step ? "step" : undefined}>
              {i < step && <Check className="mr-1 inline size-3 text-success" aria-hidden />}
              {t(s)}
            </span>
          </li>
        ))}
      </ol>

      <p className="text-xs font-medium uppercase tracking-wider text-accent">{t("onb.step", { n: step + 1 })}</p>
      <h1 ref={headingRef} tabIndex={-1} className="mt-1 text-2xl font-semibold tracking-tight outline-none sm:text-[28px]">
        {step === 3 ? t("onb.readyTitle") : t(STEPS[step])}
      </h1>
      {step === 0 && <p className="mt-1 text-sm text-muted-foreground">{t("onb.subtitle")}</p>}

      <div className="mt-6 rounded-3xl border bg-card p-5 shadow-sm sm:p-7">
        {step === 0 && (
          <form
            className="grid gap-5"
            onSubmit={(e) => {
              e.preventDefault();
              run(async () => {
                const r = await createOrganization(biz);
                if (r.ok) setOrgCreated(true);
                return r;
              }, 1);
            }}
          >
            <BusinessFields value={biz} onChange={setBiz} errors={errors} />
            {orgCreated && <LogoField logoUrl={logoUrl} />}
            <div className="flex justify-end">
              <Button type="submit" size="lg" disabled={pending}>
                {pending && <Loader2 className="animate-spin" />}
                {t("onb.next")}
              </Button>
            </div>
          </form>
        )}

        {step === 1 && (
          <form
            className="grid gap-5"
            onSubmit={(e) => {
              e.preventDefault();
              run(() => updateBank(bankV), 2);
            }}
          >
            <LogoField logoUrl={logoUrl} />
            <BankFields value={bankV} onChange={setBank} errors={errors} />
            <StepButtons pending={pending} onBack={() => setStep(0)} onSkip={() => setStep(2)} />
          </form>
        )}

        {step === 2 && (
          <form
            className="grid gap-5"
            onSubmit={(e) => {
              e.preventDefault();
              start(async () => {
                const r = await updateDocumentSettings(docs);
                if (!r.ok) {
                  setErrors(r.fieldErrors ?? {});
                  toast.error(r.error);
                  return;
                }
                setErrors({});
                const c = await completeOnboarding();
                if (!c.ok) {
                  toast.error(c.error);
                  return;
                }
                setStep(3);
              });
            }}
          >
            <DocumentFields value={docs} onChange={setDocs} errors={errors} />
            <StepButtons pending={pending} onBack={() => setStep(1)} onSkip={finish} />
          </form>
        )}

        {step === 3 && (
          <div className="grid gap-6">
            <div className="flex items-start gap-4">
              <span className="grid size-12 shrink-0 place-items-center rounded-2xl bg-success-soft text-success">
                <PartyPopper className="size-6" />
              </span>
              <p className="text-[15px] text-muted-foreground">{t("onb.readyBody")}</p>
            </div>
            <div className="rounded-2xl bg-muted/60 p-4 text-sm text-muted-foreground">{t("onb.firstQuoteSoon")}</div>
            <div className="grid gap-2 sm:grid-cols-3">
              {(
                [
                  ["/add/manual", PenLine, "add.manual"],
                  ["/add/scan", Camera, "add.scan"],
                  ["/add/voice", Mic, "add.voice"],
                ] as const
              ).map(([href, Icon, label], i) => (
                <Link key={href} href={href} className={cn(buttonVariants({ variant: i === 0 ? "default" : "outline", size: "lg" }), "w-full")}>
                  <Icon /> {i === 0 ? t("onb.recordExpense") : t(label)}
                </Link>
              ))}
            </div>
            <Link href="/" className="text-center text-sm font-medium text-primary hover:underline">
              {t("nav.expenseSummary")} →
            </Link>
          </div>
        )}
      </div>
      {step < 3 && <p className="mt-4 text-center text-xs text-muted-foreground">{t("common.notPartOfEinvoice")}</p>}
    </div>
  );
}

function StepButtons({ pending, onBack, onSkip }: { pending: boolean; onBack: () => void; onSkip: () => void }) {
  const { t } = useI18n();
  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <Button type="button" variant="ghost" onClick={onBack} disabled={pending}>
        {t("onb.back")}
      </Button>
      <div className="flex gap-2">
        <Button type="button" variant="outline" onClick={onSkip} disabled={pending}>
          {t("onb.skip")}
        </Button>
        <Button type="submit" disabled={pending}>
          {pending && <Loader2 className="animate-spin" />}
          {t("onb.next")}
        </Button>
      </div>
    </div>
  );
}
