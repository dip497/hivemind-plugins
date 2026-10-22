// shadcn/ui's Input.
import type { ComponentProps } from "react";
import { cn } from "./cn";

export function Input({ className, ...props }: ComponentProps<"input">) {
  return (
    <input
      data-slot="input"
      className={cn("h-8 w-full min-w-0 rounded-md border border-input bg-background px-2.5 text-[13px] text-foreground outline-none placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring", className)}
      {...props}
    />
  );
}
