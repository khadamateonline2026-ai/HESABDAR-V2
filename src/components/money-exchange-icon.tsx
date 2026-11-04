import { cn } from "@/lib/utils";

export function MoneyExchangeIcon({ className }: { className?: string }) {
  return (
    <span
      aria-hidden
      className={cn("pay-icon inline-block size-7 bg-current", className)}
      style={{
        WebkitMask: 'url("/pay-icon.png?v=3") center / contain no-repeat',
        mask: 'url("/pay-icon.png?v=3") center / contain no-repeat',
      }}
    />
  );
}