import Link from "next/link";
import { ChevronLeft } from "lucide-react";

export function PageHeader({ title, back, action, subtitle }: { title: string; back?: string; action?: React.ReactNode; subtitle?: string }) {
  return (
    <header className="mb-5 flex items-center gap-2">
      {back && (
        <Link href={back} className="-ml-2 grid size-10 place-items-center rounded-full hover:bg-muted" aria-label="Back">
          <ChevronLeft className="size-6" />
        </Link>
      )}
      <div className="min-w-0 flex-1">
        <h1 className="truncate text-[26px] font-semibold tracking-tight">{title}</h1>
        {subtitle && <p className="text-sm text-muted-foreground">{subtitle}</p>}
      </div>
      {action}
    </header>
  );
}
