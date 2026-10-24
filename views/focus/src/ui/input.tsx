// The app's field (DESIGN.md, Inputs): graphite-ground fill, control-line edge, 6px corners, 32px.
import type { InputHTMLAttributes } from "react";
import { cn } from "./cn";

export function Input({ className, ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return <input className={cn("h-8 w-full min-w-0 rounded-md border border-control bg-ground px-2.5 text-body text-chalk placeholder:text-dust outline-none focus-visible:border-pencil", className)} {...props} />;
}
