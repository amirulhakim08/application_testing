/** BukuTigaLima mark: a ledger book (Buku 555) with a copper bookmark ribbon. */
export function LogoMark({ className = "size-8" }: { className?: string }) {
  return (
    <svg viewBox="0 0 64 64" className={className} aria-hidden>
      <rect width="64" height="64" rx="16" fill="#17324D" />
      <path d="M15 18c6-2.5 11.5-2 17 1.5V48c-5.5-3.5-11-4-17-1.5z" fill="#FAF8F4" />
      <path d="M49 18c-6-2.5-11.5-2-17 1.5V48c5.5-3.5 11-4 17-1.5z" fill="#E9E2D6" />
      <path d="M20 26h7M20 31h7M20 36h5M37 26h7M37 31h7" stroke="#17324D" strokeWidth="2" strokeLinecap="round" opacity="0.55" />
      <path d="M40 15h6v15l-3-2.4-3 2.4z" fill="#B77945" />
    </svg>
  );
}

export function Logo({ compact = false }: { compact?: boolean }) {
  return (
    <span className="flex items-center gap-2.5">
      <LogoMark />
      {!compact && (
        <span className="text-lg font-semibold tracking-tight">
          Buku<span className="text-accent">TigaLima</span>
        </span>
      )}
    </span>
  );
}
