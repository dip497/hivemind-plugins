// The app's two buttons (DESIGN.md, Buttons): primary is chalk on graphite, 32px, 6px corners; ghost
// is pencil text on nothing that takes the card fill under the pointer. Press scales to 0.96.
import type { ButtonHTMLAttributes } from "react";
import { cn } from "./cn";

const LOOK = {
  primary: "bg-chalk text-ground font-medium hover:opacity-90 px-3",
  ghost: "text-pencil hover:bg-card hover:text-chalk px-2.5",
} as const;

export function Button({ variant = "ghost", className, ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: keyof typeof LOOK }) {
  return (
    <button
      type="button"
      className={cn("inline-flex h-8 shrink-0 items-center justify-center gap-1.5 rounded-md text-body whitespace-nowrap transition-[background-color,color,opacity,transform] duration-150 ease-[cubic-bezier(0.32,0.72,0,1)] active:scale-[0.96] disabled:pointer-events-none disabled:opacity-45", LOOK[variant], className)}
      {...props}
    />
  );
}
