"use client";
import * as React from "react";
import { cn } from "@/lib/utils";

export function Segmented<T extends string>({
  value,
  onChange,
  options,
  className,
  size = "default",
  name,
}: {
  value: T | null;
  onChange: (v: T) => void;
  options: Array<{ value: T; label: React.ReactNode; tone?: "personal" | "company" }>;
  className?: string;
  size?: "default" | "sm";
  name?: string;
}) {
  return (
    <div role="radiogroup" aria-label={name} className={cn("flex rounded-full bg-muted p-1", className)}>
      {options.map((o) => {
        const active = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => onChange(o.value)}
            className={cn(
              "flex flex-1 items-center justify-center gap-1.5 whitespace-nowrap rounded-full font-medium transition-all",
              size === "sm" ? "h-8 px-3 text-[13px]" : "h-10 px-4 text-sm",
              active
                ? o.tone === "company"
                  ? "bg-company text-white shadow-sm dark:text-[#0b110e]"
                  : o.tone === "personal"
                    ? "bg-primary text-primary-foreground shadow-sm"
                    : "bg-card text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}
