"use client";

import * as React from "react";
import { Eye, EyeOff } from "lucide-react";
import { useI18n } from "@/components/providers";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

/** Password field with a show/hide button, so long passwords can be checked before submitting. */
export function PasswordInput({ className, ...props }: Omit<React.ComponentProps<"input">, "type">) {
  const { t } = useI18n();
  const [show, setShow] = React.useState(false);
  return (
    <div className="relative">
      <Input {...props} type={show ? "text" : "password"} autoCapitalize="none" autoCorrect="off" spellCheck={false} className={cn("pr-12", className)} />
      <button
        type="button"
        onClick={() => setShow((s) => !s)}
        aria-label={show ? t("auth.hidePassword") : t("auth.showPassword")}
        aria-pressed={show}
        className="absolute right-1 top-1/2 grid size-10 -translate-y-1/2 place-items-center rounded-full text-muted-foreground hover:bg-muted hover:text-foreground"
      >
        {show ? <EyeOff className="size-5" /> : <Eye className="size-5" />}
      </button>
    </div>
  );
}
