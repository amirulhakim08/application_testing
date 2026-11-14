export function LogoMark({ className = "size-8" }: { className?: string }) {
  return (
    <svg viewBox="0 0 64 64" className={className} aria-hidden>
      <rect width="64" height="64" rx="18" fill="var(--primary)" />
      <path d="M20 16v32M20 33l15-17M26 27l13 21" stroke="var(--primary-foreground)" strokeWidth="6" strokeLinecap="round" strokeLinejoin="round" fill="none" />
      <circle cx="46" cy="18" r="5" fill="var(--accent)" />
    </svg>
  );
}

export function Logo() {
  return (
    <span className="flex items-center gap-2.5">
      <LogoMark />
      <span className="text-xl font-semibold tracking-tight">
        Kira<span className="text-primary">Go</span>
      </span>
    </span>
  );
}
