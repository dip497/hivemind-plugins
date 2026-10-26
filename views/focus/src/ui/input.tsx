// The app's field (DESIGN.md, Inputs): graphite-ground fill, 6px corners, 32px. Its fill is the ground
// it sits on, so its edge alone outlines it: fg3, at 3:1 on the ground (the control line is 1.43:1).
import type { InputHTMLAttributes } from "react";
import { cn } from "./cn";

export function Input({ className, ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return <input className={cn("h-8 w-full min-w-0 rounded-md border border-edge bg-ground px-2.5 text-body text-chalk placeholder:text-dust outline-none focus-visible:border-pencil", className)} {...props} />;
}
