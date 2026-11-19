"use client";

import * as React from "react";
import { useTheme } from "next-themes";
import { Moon, Sun } from "lucide-react";
import { useI18n } from "@/components/providers";
import { updatePreferences } from "@/app/actions/settings";
import { cn } from "@/lib/utils";

/** One-tap day/night switch. Saves the choice to the profile so it follows the user to other devices. */
export function ThemeToggle({ className }: { className?: string }) {
  const { resolvedTheme, setTheme } = useTheme();
  const { t } = useI18n();
  const [mounted, setMounted] = React.useState(false);
  React.useEffect(() => setMounted(true), []);
  const dark = mounted && resolvedTheme === "dark";
  const label = dark ? t("theme.toLight") : t("theme.toDark");
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={() => {
        const next = dark ? "light" : "dark";
        setTheme(next);
        void updatePreferences({ theme: next });
      }}
      className={cn("grid size-11 place-items-center rounded-xl text-foreground hover:bg-muted", className)}
    >
      {dark ? <Sun className="size-5" /> : <Moon className="size-5" />}
    </button>
  );
}
