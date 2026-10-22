// shadcn/ui's Badge, with one variant per group of agents.
import { cva, type VariantProps } from "class-variance-authority";
import type { ComponentProps } from "react";
import { cn } from "./cn";

const badgeVariants = cva("inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium whitespace-nowrap", {
  variants: {
    variant: {
      needs: "border-transparent bg-attention/15 text-attention",
      working: "border-border text-foreground",
      ready: "border-border text-muted-foreground",
      stopped: "border-transparent bg-muted text-muted-foreground",
      failed: "border-transparent bg-failed/15 text-failed",
    },
  },
  defaultVariants: { variant: "ready" },
});

export function Badge({ className, variant, ...props }: ComponentProps<"span"> & VariantProps<typeof badgeVariants>) {
  return <span data-slot="badge" className={cn(badgeVariants({ variant }), className)} {...props} />;
}
