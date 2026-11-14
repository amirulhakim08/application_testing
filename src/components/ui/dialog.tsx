"use client";
import * as React from "react";
import { Dialog as D } from "radix-ui";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";

export const Dialog = D.Root;
export const DialogTrigger = D.Trigger;
export const DialogClose = D.Close;

/** Bottom sheet on mobile, centered dialog on larger screens. */
export function DialogContent({
  className,
  children,
  title,
  description,
  hideClose,
  ...props
}: React.ComponentProps<typeof D.Content> & { title: string; description?: string; hideClose?: boolean }) {
  return (
    <D.Portal>
      <D.Overlay className="fixed inset-0 z-50 bg-black/40 backdrop-blur-[2px] data-[state=open]:animate-[fade-up_0.2s_ease]" />
      <D.Content
        className={cn(
          "fixed inset-x-0 bottom-0 z-50 max-h-[92dvh] overflow-y-auto rounded-t-3xl border bg-card p-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] shadow-2xl data-[state=open]:animate-sheet-up",
          "sm:inset-auto sm:left-1/2 sm:top-1/2 sm:w-full sm:max-w-md sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-3xl sm:data-[state=open]:animate-fade-up",
          className,
        )}
        {...props}
      >
        <div className="mx-auto mb-3 h-1 w-10 rounded-full bg-border sm:hidden" />
        <div className="mb-4 flex items-start justify-between gap-4">
          <div>
            <D.Title className="text-lg font-semibold tracking-tight">{title}</D.Title>
            {description ? <D.Description className="mt-1 text-sm text-muted-foreground">{description}</D.Description> : <D.Description className="sr-only">{title}</D.Description>}
          </div>
          {!hideClose && (
            <D.Close className="-mr-1 -mt-1 rounded-full p-2 text-muted-foreground hover:bg-muted" aria-label="Close">
              <X className="size-5" />
            </D.Close>
          )}
        </div>
        {children}
      </D.Content>
    </D.Portal>
  );
}
