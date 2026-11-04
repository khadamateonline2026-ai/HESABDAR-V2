import { cn } from "@/lib/utils";
import type { ButtonHTMLAttributes } from "react";

const variants = {
  primary: "bg-primary text-primary-fg hover:brightness-110 disabled:opacity-55",
  secondary:
    "border border-white/25 bg-white/10 text-fg backdrop-blur-xl hover:bg-white/15 disabled:opacity-55",
  ghost: "text-fg hover:bg-white/10 disabled:opacity-55",
  danger: "bg-danger text-white hover:brightness-110 disabled:opacity-55",
} as const;

export function Button({
  className,
  variant = "primary",
  type = "button",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: keyof typeof variants }) {
  return (
    <button
      type={type}
      className={cn(
        "inline-flex h-11 items-center justify-center gap-2 rounded-[12px] px-4 text-sm font-semibold transition-[opacity,transform,background-color,box-shadow] duration-200 active:scale-[0.97]",
        variants[variant],
        className,
      )}
      {...props}
    />
  );
}
