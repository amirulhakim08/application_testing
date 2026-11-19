import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const badgeVariants = cva("inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium [&_svg]:size-3", {
  variants: {
    variant: {
      default: "bg-muted text-muted-foreground",
      personal: "bg-primary-soft text-primary",
      company: "bg-company-soft text-company",
      warning: "bg-warning-soft text-warning",
      outline: "border text-muted-foreground",
      success: "bg-success-soft text-success",
      accent: "bg-accent-soft text-accent",
      danger: "bg-destructive/10 text-destructive",
      info: "bg-primary-soft text-primary",
    },
  },
  defaultVariants: { variant: "default" },
});

export function Badge({ className, variant, ...props }: React.ComponentProps<"span"> & VariantProps<typeof badgeVariants>) {
  return <span className={cn(badgeVariants({ variant }), className)} {...props} />;
}
